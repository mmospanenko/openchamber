import { describe, expect, it } from 'vitest';

import { ServerController } from './ServerController';
import { ServerManager, type ChildProcessLike, type ServerManagerOptions } from './ServerManager';
import type { ServerState } from './types';

type ExitListener = (code: number | null, signal: NodeJS.Signals | null) => void;

class FakeChild implements ChildProcessLike {
  pid = 5150;
  stdout = {
    on: (_event: 'data', listener: (chunk: Buffer) => void) => {
      this.dataListeners.push(listener);
    },
  };
  stderr = null;
  readonly signals: NodeJS.Signals[] = [];

  private readonly dataListeners: ((chunk: Buffer) => void)[] = [];
  private readonly exitListeners: ExitListener[] = [];

  kill(signal?: NodeJS.Signals): boolean {
    this.signals.push(signal ?? 'SIGTERM');
    this.emitExit(0, 'SIGTERM');
    return true;
  }

  onExit(listener: ExitListener): void {
    this.exitListeners.push(listener);
  }

  onError(listener: (error: Error) => void): void {
    void listener;
  }

  emitStdout(text: string): void {
    const buffer = Buffer.from(text);
    for (const listener of this.dataListeners) listener(buffer);
  }

  emitExit(code: number | null, signal: NodeJS.Signals | null): void {
    for (const listener of this.exitListeners) listener(code, signal);
  }
}

const optionsFor = (port: number, child: FakeChild): ServerManagerOptions => ({
  resolveBinary: async () => '/fake/openchamber',
  port,
  cwd: '/vault',
  projectDirectory: '/vault',
  platform: 'darwin',
  comSpec: undefined,
  spawn: () => child,
  taskkill: async () => undefined,
  readyTimeoutMs: 200,
  terminateGraceMs: 50,
});

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

interface Harness {
  controller: ServerController;
  children: FakeChild[];
  setPort(port: number): void;
}

const createHarness = (): Harness => {
  let port = 3000;
  const children: FakeChild[] = [];
  const controller = new ServerController({
    createManager: () => {
      const child = new FakeChild();
      children.push(child);
      return new ServerManager(optionsFor(port, child));
    },
  });
  return {
    controller,
    children,
    setPort: (next) => {
      port = next;
    },
  };
};

const startAndReady = async (harness: Harness, index: number, reportedPort: number): Promise<void> => {
  const starting = harness.controller.start();
  await flush();
  harness.children[index]?.emitStdout(
    `OpenChamber server listening on 127.0.0.1:${reportedPort}\n`,
  );
  await starting;
};

describe('ServerController', () => {
  it('reports stopped, null URL, and null error before the first start', () => {
    const harness = createHarness();

    expect(harness.controller.getState()).toBe('stopped');
    expect(harness.controller.getUrl()).toBeNull();
    expect(harness.controller.getErrorMessage()).toBeNull();
  });

  it('starts a manager and forwards state changes to subscribers', async () => {
    const harness = createHarness();
    const states: ServerState[] = [];
    harness.controller.onStateChange((state) => states.push(state));

    const starting = harness.controller.start();
    await flush();
    expect(harness.controller.getState()).toBe('starting');
    harness.children[0]?.emitStdout('OpenChamber server listening on 127.0.0.1:3000\n');
    await starting;

    expect(harness.controller.getState()).toBe('running');
    expect(harness.controller.getUrl()).toBe('http://127.0.0.1:3000');
    expect(states).toEqual(['starting', 'running']);
  });

  it('rebuilds the manager on every start so a changed port applies', async () => {
    const harness = createHarness();
    await startAndReady(harness, 0, 3000);
    await harness.controller.stop();

    harness.setPort(4100);
    await startAndReady(harness, 1, 4100);

    expect(harness.children.length).toBe(2);
    expect(harness.controller.getUrl()).toBe('http://127.0.0.1:4100');
  });

  it('stops the running manager', async () => {
    const harness = createHarness();
    await startAndReady(harness, 0, 3000);

    await harness.controller.stop();

    expect(harness.controller.getState()).toBe('stopped');
    expect(harness.children[0]?.signals).toEqual(['SIGTERM']);
  });

  it('restarts by stopping the current manager and starting a fresh one', async () => {
    const harness = createHarness();
    await startAndReady(harness, 0, 3000);

    const restarting = harness.controller.restart();
    await flush();
    expect(harness.children[0]?.signals).toEqual(['SIGTERM']);
    harness.children[1]?.emitStdout('OpenChamber server listening on 127.0.0.1:3000\n');
    await restarting;

    expect(harness.children.length).toBe(2);
    expect(harness.controller.getState()).toBe('running');
    expect(harness.controller.getUrl()).toBe('http://127.0.0.1:3000');
  });

  it('forwards error messages from the manager', async () => {
    const controller = new ServerController({
      createManager: () =>
        new ServerManager({
          ...optionsFor(3000, new FakeChild()),
          resolveBinary: async () => null,
        }),
    });
    const errors: string[] = [];
    controller.onError((message) => errors.push(message));

    await expect(controller.start()).rejects.toThrowError();
    await flush();

    expect(controller.getState()).toBe('error');
    expect(controller.getErrorMessage()).toContain('executable not found');
    expect(errors.length).toBe(1);
  });

  it('stops forwarding to a listener after it unsubscribes', async () => {
    const harness = createHarness();
    const states: ServerState[] = [];
    const unsubscribe = harness.controller.onStateChange((state) => states.push(state));

    const starting = harness.controller.start();
    await flush();
    unsubscribe();
    harness.children[0]?.emitStdout('OpenChamber server listening on 127.0.0.1:3000\n');
    await starting;

    expect(states).toEqual(['starting']);
  });

  it('reports getPort as null when not running and reported port when running', async () => {
    const harness = createHarness();
    expect(harness.controller.getPort()).toBeNull();

    await startAndReady(harness, 0, 3000);
    expect(harness.controller.getPort()).toBe(3000);

    await harness.controller.stop();
    expect(harness.controller.getPort()).toBeNull();
  });

  it('forwards notice messages from the manager', async () => {
    const harness = createHarness();
    const notices: string[] = [];
    harness.controller.onNotice((msg) => notices.push(msg));

    const starting = harness.controller.start();
    await flush();

    harness.children[0]?.emitStdout('OpenChamber server listening on 127.0.0.1:49152\n');
    await starting;

    expect(notices).toEqual(['Port 3000 is in use; using port 49152.']);
  });
});
