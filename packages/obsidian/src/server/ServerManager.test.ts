import { describe, expect, it, vi } from 'vitest';

import {
  ServerManager,
  type ChildErrorListener,
  type ChildProcessLike,
  type ExitListener,
  type ReadableLike,
  type SpawnFunction,
  type SpawnOptionsLike,
  type TaskkillFunction,
} from './ServerManager';

type DataListener = (chunk: Buffer) => void;

class FakeReadable implements ReadableLike {
  private listeners: DataListener[] = [];

  on(_event: 'data', listener: DataListener): void {
    this.listeners.push(listener);
  }

  emit(text: string): void {
    const buffer = Buffer.from(text);
    for (const listener of this.listeners) listener(buffer);
  }
}

class FakeChild implements ChildProcessLike {
  pid = 4242;
  stdout = new FakeReadable();
  stderr = new FakeReadable();
  readonly signals: NodeJS.Signals[] = [];
  respondToKill = true;

  private exitListeners: ExitListener[] = [];
  private errorListeners: ChildErrorListener[] = [];

  onExit(listener: ExitListener): void {
    this.exitListeners.push(listener);
  }

  onError(listener: ChildErrorListener): void {
    this.errorListeners.push(listener);
  }

  kill(signal?: NodeJS.Signals): boolean {
    const next = signal ?? 'SIGTERM';
    this.signals.push(next);
    if (this.respondToKill) this.emitExit(0, next);
    return true;
  }

  emitStdout(text: string): void {
    this.stdout.emit(text);
  }

  emitStderr(text: string): void {
    this.stderr.emit(text);
  }

  emitExit(code: number | null, signal: NodeJS.Signals | null): void {
    for (const listener of this.exitListeners) listener(code, signal);
  }

  emitError(error: Error): void {
    for (const listener of this.errorListeners) listener(error);
  }
}

interface Harness {
  manager: ServerManager;
  child: FakeChild;
  children: FakeChild[];
  taskkillCalls: { pid: number; force: boolean }[];
  spawnArgs: string[][];
  spawnOptions: SpawnOptionsLike[];
  states: string[];
  errors: string[];
  notices: string[];
  emitExit(code: number | null, signal: NodeJS.Signals | null): void;
}

const createHarness = (overrides?: {
  platform?: NodeJS.Platform;
  readyTimeoutMs?: number;
  terminateGraceMs?: number;
  binary?: string | null;
  children?: FakeChild[];
  isPortAvailable?: (port: number) => Promise<boolean>;
  findAvailablePort?: () => Promise<number>;
}): Harness => {
  const queuedChildren = overrides?.children ? [...overrides.children] : [];
  const spawnedChildren: FakeChild[] = [];
  const firstChild = queuedChildren.shift() ?? new FakeChild();
  spawnedChildren.push(firstChild);

  const taskkillCalls: { pid: number; force: boolean }[] = [];
  const spawnArgs: string[][] = [];
  const spawnOptions: SpawnOptionsLike[] = [];
  const states: string[] = [];
  const errors: string[] = [];
  const notices: string[] = [];

  const spawn: SpawnFunction = vi.fn((_binary, args, options) => {
    spawnArgs.push(args);
    spawnOptions.push(options);
    if (spawnArgs.length === 1) {
      return firstChild;
    }
    const nextChild = queuedChildren.shift() ?? new FakeChild();
    spawnedChildren.push(nextChild);
    return nextChild;
  });
  const taskkill: TaskkillFunction = async (pid, force) => {
    taskkillCalls.push({ pid, force });
  };

  const manager = new ServerManager({
    resolveBinary: async () => (overrides?.binary === undefined ? '/fake/openchamber' : overrides.binary),
    port: 3000,
    cwd: '/vault',
    projectDirectory: '/vault',
    platform: overrides?.platform ?? 'darwin',
    comSpec: undefined,
    spawn,
    taskkill,
    isPortAvailable: overrides?.isPortAvailable,
    findAvailablePort: overrides?.findAvailablePort,
    readyTimeoutMs: overrides?.readyTimeoutMs ?? 1000,
    terminateGraceMs: overrides?.terminateGraceMs ?? 1000,
  });
  manager.onStateChange((state) => states.push(state));
  manager.onError((message) => errors.push(message));
  manager.onNotice?.((message) => notices.push(message));

  return {
    manager,
    child: firstChild,
    children: spawnedChildren,
    taskkillCalls,
    spawnArgs,
    spawnOptions,
    states,
    errors,
    notices,
    emitExit: (code, signal) => firstChild.emitExit(code, signal),
  };
};

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('ServerManager lifecycle', () => {
  it('moves stopped -> starting -> running -> stopped and detects the reported port', async () => {
    const harness = createHarness();
    expect(harness.manager.getState()).toBe('stopped');

    const starting = harness.manager.start();
    expect(harness.manager.getState()).toBe('starting');
    await flush();

    harness.child.emitStdout('OpenChamber server listening on 127.0.0.1:3000\n');
    await starting;

    expect(harness.manager.getState()).toBe('running');
    expect(harness.manager.getUrl()).toBe('http://127.0.0.1:3000');
    expect(harness.states).toEqual(['starting', 'running']);

    await harness.manager.stop();
    expect(harness.manager.getState()).toBe('stopped');
    expect(harness.child.signals).toEqual(['SIGTERM']);
    expect(harness.states).toEqual(['starting', 'running', 'stopped']);
  });

  it('detects a port when the ready line arrives across chunks', async () => {
    const harness = createHarness();
    const starting = harness.manager.start();
    await flush();
    harness.child.emitStdout('OpenChamber server list');
    harness.child.emitStdout('ening on 127.0.0.1:4123\n');
    await starting;

    expect(harness.manager.getUrl()).toBe('http://127.0.0.1:4123');
  });

  it('becomes error on a non-zero exit without a stop request', async () => {
    const harness = createHarness();
    const starting = harness.manager.start();
    await flush();
    harness.child.emitExit(1, null);
    await expect(starting).rejects.toThrowError();
    await flush();

    expect(harness.manager.getState()).toBe('error');
    expect(harness.errors.length).toBe(1);
  });

  it('becomes error when a running server exits on its own', async () => {
    const harness = createHarness();
    const starting = harness.manager.start();
    await flush();
    harness.child.emitStdout('OpenChamber server listening on 127.0.0.1:3000\n');
    await starting;
    expect(harness.manager.getState()).toBe('running');

    harness.child.emitExit(1, null);
    await flush();

    expect(harness.manager.getState()).toBe('error');
    expect(harness.manager.getUrl()).toBeNull();
    expect(harness.manager.getErrorMessage()).toContain('exited');
    expect(harness.errors.length).toBe(1);
  });

  it('becomes error when a running server emits an error event', async () => {
    const harness = createHarness();
    const starting = harness.manager.start();
    await flush();
    harness.child.emitStdout('OpenChamber server listening on 127.0.0.1:3000\n');
    await starting;

    harness.child.emitError(new Error('socket hang up'));
    await flush();

    expect(harness.manager.getState()).toBe('error');
    expect(harness.manager.getErrorMessage()).toContain('socket hang up');
  });

  it('becomes error when the spawn emits an error event', async () => {
    const harness = createHarness();
    const starting = harness.manager.start();
    await flush();
    harness.child.emitError(new Error('spawn ENOENT'));
    await expect(starting).rejects.toThrowError();
    await flush();

    expect(harness.manager.getState()).toBe('error');
    expect(harness.errors.at(-1)).toContain('spawn ENOENT');
  });

  it('signals and transitions to stopped on stop()', async () => {
    const harness = createHarness();
    const starting = harness.manager.start();
    await flush();
    harness.child.emitStdout('OpenChamber server listening on 127.0.0.1:3000\n');
    await starting;

    await harness.manager.stop();

    expect(harness.child.signals).toEqual(['SIGTERM']);
    expect(harness.manager.getState()).toBe('stopped');
    expect(harness.manager.getUrl()).toBeNull();
  });

  it('is a no-op to start while running', async () => {
    const harness = createHarness();
    const starting = harness.manager.start();
    await flush();
    harness.child.emitStdout('OpenChamber server listening on 127.0.0.1:3000\n');
    await starting;

    await harness.manager.start();

    expect(harness.manager.getState()).toBe('running');
  });

  it('does not spawn a child when stopped while resolution is still pending', async () => {
    const spawned: FakeChild[] = [];
    let release: () => void = () => {};
    const manager = new ServerManager({
      resolveBinary: () =>
        new Promise((resolve) => {
          release = () => resolve('/fake/openchamber');
        }),
      port: 3000,
      cwd: '/vault',
      projectDirectory: '/vault',
      platform: 'darwin',
      comSpec: undefined,
      spawn: vi.fn(() => {
        const child = new FakeChild();
        spawned.push(child);
        return child;
      }),
      taskkill: async () => undefined,
      readyTimeoutMs: 30,
      terminateGraceMs: 10,
    });

    const starting = manager.start();
    await flush();
    await manager.stop();
    release();
    await starting.catch(() => undefined);
    await flush();

    expect(spawned.length).toBe(0);
    expect(manager.getState()).toBe('stopped');
    expect(manager.getUrl()).toBeNull();
  });

  it('terminates and errors when the ready line never arrives in time', async () => {
    const harness = createHarness({ readyTimeoutMs: 20, terminateGraceMs: 5 });
    harness.child.respondToKill = false;

    const starting = harness.manager.start();

    await expect(starting).rejects.toThrowError();
    await flush();

    expect(harness.manager.getState()).toBe('error');
    expect(harness.child.signals).toEqual(['SIGTERM', 'SIGKILL']);
  });

  it('errors when no executable resolves', async () => {
    const harness = createHarness({ binary: null });

    await expect(harness.manager.start()).rejects.toThrowError();
    await flush();

    expect(harness.manager.getState()).toBe('error');
    expect(harness.errors.at(-1)).toContain('executable');
    expect(harness.child.signals).toEqual([]);
  });

  it('errors and reports the message when resolution rejects', async () => {
    const child = new FakeChild();
    const states: string[] = [];
    const errors: string[] = [];
    const manager = new ServerManager({
      resolveBinary: async () => {
        throw new Error('Configured OpenChamber executable is not a runnable file: /bad/path');
      },
      port: 3000,
      cwd: '/vault',
      projectDirectory: null,
      platform: 'darwin',
      comSpec: undefined,
      spawn: vi.fn(() => child),
      taskkill: async () => undefined,
    });
    manager.onStateChange((state) => states.push(state));
    manager.onError((message) => errors.push(message));

    await expect(manager.start()).rejects.toThrowError('/bad/path');
    await flush();

    expect(manager.getState()).toBe('error');
    expect(manager.getErrorMessage()).toContain('/bad/path');
    expect(errors.at(-1)).toContain('/bad/path');
    expect(child.signals).toEqual([]);
  });

  it('reports the CLI stderr message when the server exits before ready', async () => {
    const harness = createHarness();
    const starting = harness.manager.start();
    await flush();
    harness.child.emitStderr('Error: Failed to initialize runtime: permission denied.\n');
    harness.child.emitExit(1, null);
    await expect(starting).rejects.toThrowError();

    expect(harness.manager.getState()).toBe('error');
    expect(harness.manager.getErrorMessage()).toContain('permission denied');
    expect(harness.errors.at(-1)).toContain('permission denied');
  });

  it('retries on a resolved free port when the preferred port conflicts at spawn and reaches running', async () => {
    const child1 = new FakeChild();
    const child2 = new FakeChild();
    const harness = createHarness({ children: [child1, child2], findAvailablePort: async () => 49152 });

    const starting = harness.manager.start();
    await flush();

    expect(harness.spawnArgs[0]).toEqual(['serve', '--port', '3000', '--foreground']);

    child1.emitStderr('Error: Port 3000 is already in use by another process.\n');
    child1.emitExit(1, null);
    await flush();

    expect(harness.spawnArgs[1]).toEqual(['serve', '--port', '49152', '--foreground']);

    child2.emitStdout('OpenChamber server listening on 127.0.0.1:49152\n');
    await starting;

    expect(harness.manager.getState()).toBe('running');
    expect(harness.manager.getUrl()).toBe('http://127.0.0.1:49152');
    expect(harness.manager.getPort()).toBe(49152);
    expect(harness.notices).toEqual(['Port 3000 is in use; using port 49152.']);
    expect(harness.errors).toEqual([]);
  });

  it('starts on a resolved free port when the pre-spawn port probe detects the preferred port is unavailable', async () => {
    const harness = createHarness({
      isPortAvailable: async () => false,
      findAvailablePort: async () => 49152,
    });

    const starting = harness.manager.start();
    await flush();

    expect(harness.spawnArgs[0]).toEqual(['serve', '--port', '49152', '--foreground']);

    harness.child.emitStdout('OpenChamber server listening on 127.0.0.1:49152\n');
    await starting;

    expect(harness.manager.getState()).toBe('running');
    expect(harness.manager.getUrl()).toBe('http://127.0.0.1:49152');
    expect(harness.manager.getPort()).toBe(49152);
    expect(harness.notices).toEqual(['Port 3000 is in use; using port 49152.']);
  });

  it('starts without --port when the pre-spawn port probe fails and no port resolver is supplied', async () => {
    const harness = createHarness({
      isPortAvailable: async () => false,
    });

    const starting = harness.manager.start();
    await flush();

    expect(harness.spawnArgs[0]).toEqual(['serve', '--foreground']);

    harness.child.emitStdout('OpenChamber server listening on 127.0.0.1:49153\n');
    await starting;

    expect(harness.manager.getState()).toBe('running');
    expect(harness.manager.getUrl()).toBe('http://127.0.0.1:49153');
    expect(harness.manager.getPort()).toBe(49153);
    expect(harness.notices).toEqual(['Port 3000 is in use; using port 49153.']);
  });

  it('reports the CLI stderr message when fallback attempt also exits before ready', async () => {
    const child1 = new FakeChild();
    const child2 = new FakeChild();
    const harness = createHarness({ children: [child1, child2], findAvailablePort: async () => 49152 });

    const starting = harness.manager.start();
    await flush();

    child1.emitStderr('Error: Port 3000 is already in use by another process.\n');
    child1.emitExit(1, null);
    await flush();

    expect(harness.spawnArgs[1]).toEqual(['serve', '--port', '49152', '--foreground']);

    child2.emitStderr('Error: Failed to bind free port.\n');
    child2.emitExit(1, null);

    await expect(starting).rejects.toThrowError();
    expect(harness.manager.getState()).toBe('error');
    expect(harness.manager.getErrorMessage()).toContain('Failed to bind free port');
    expect(harness.errors.at(-1)).toContain('Failed to bind free port');
  });

  it('sets OPENCHAMBER_DATA_DIR on the child when a data directory is provided', async () => {
    const spawnOptions: SpawnOptionsLike[] = [];
    const child = new FakeChild();
    const manager = new ServerManager({
      resolveBinary: async () => '/fake/openchamber',
      port: 3000,
      cwd: '/vault',
      projectDirectory: '/vault',
      dataDir: '/home/user/.config/openchamber/obsidian-vaults/abc',
      platform: 'darwin',
      comSpec: undefined,
      spawn: (_binary, _args, options) => {
        spawnOptions.push(options);
        return child;
      },
      taskkill: async () => undefined,
      readyTimeoutMs: 1000,
      terminateGraceMs: 1000,
    });
    const starting = manager.start();
    await flush();
    child.emitStdout('OpenChamber server listening on 127.0.0.1:3000\n');
    await starting;

    const [options] = spawnOptions;
    if (options === undefined) throw new Error('spawn was not called');
    expect(options.env.OPENCHAMBER_DATA_DIR).toBe('/home/user/.config/openchamber/obsidian-vaults/abc');
  });

  it('omits OPENCHAMBER_DATA_DIR when no data directory is provided', async () => {
    const harness = createHarness();
    const starting = harness.manager.start();
    await flush();
    harness.child.emitStdout('OpenChamber server listening on 127.0.0.1:3000\n');
    await starting;

    const [options] = harness.spawnOptions;
    if (options === undefined) throw new Error('spawn was not called');
    expect(options.env.OPENCHAMBER_DATA_DIR).toBeUndefined();
  });

  it('puts the resolved executable directory on the child PATH', async () => {
    const harness = createHarness({ binary: '/opt/tools/bin/openchamber' });
    const starting = harness.manager.start();
    await flush();
    harness.child.emitStdout('OpenChamber server listening on 127.0.0.1:3000\n');
    await starting;

    const [options] = harness.spawnOptions;
    if (options === undefined) throw new Error('spawn was not called');
    expect(options.env.PATH?.split(':')[0]).toBe('/opt/tools/bin');
  });

  it('uses taskkill on Windows instead of direct signals', async () => {
    const harness = createHarness({ platform: 'win32', terminateGraceMs: 10 });
    const starting = harness.manager.start();
    await flush();
    harness.child.emitStdout('OpenChamber server listening on 127.0.0.1:3000\n');
    await starting;

    harness.child.respondToKill = false;
    await harness.manager.stop();

    expect(harness.child.signals).toEqual([]);
    expect(harness.taskkillCalls).toEqual([
      { pid: 4242, force: false },
      { pid: 4242, force: true },
    ]);
  });
});
