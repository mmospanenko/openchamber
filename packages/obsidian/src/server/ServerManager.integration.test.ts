import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ServerManager, type SpawnFunction } from './ServerManager';
import { getAvailablePortNode, nodeSpawn, taskkillProcess } from './nodeSpawn';

const here = path.dirname(fileURLToPath(import.meta.url));
const stubPath = path.resolve(here, '../../test/fixtures/openchamber-stub');
const conflictStubPath = path.resolve(here, '../../test/fixtures/openchamber-conflict-stub');

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const waitForExit = async (pid: number): Promise<boolean> => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (!isAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return !isAlive(pid);
};

describe('ServerManager integration with the stub process', () => {
  it('starts the stub, parses its port, then stops it without leaving a live PID', async () => {
    process.env.OPENCHAMBER_STUB_PORT = '4567';
    const pids: number[] = [];
    const recordingSpawn: SpawnFunction = (binary, args, options) => {
      const child = nodeSpawn(binary, args, options);
      if (child.pid !== undefined) pids.push(child.pid);
      return child;
    };

    const manager = new ServerManager({
      resolveBinary: async () => stubPath,
      port: 4567,
      cwd: here,
      projectDirectory: null,
      platform: process.platform,
      comSpec: undefined,
      spawn: recordingSpawn,
      taskkill: taskkillProcess,
    });

    await manager.start();

    expect(manager.getState()).toBe('running');
    expect(manager.getUrl()).toBe('http://127.0.0.1:4567');

    const [pid] = pids;
    if (pid === undefined) throw new Error('stub child did not expose a pid');
    expect(isAlive(pid)).toBe(true);

    await manager.stop();

    expect(manager.getState()).toBe('stopped');
    expect(manager.getUrl()).toBeNull();
    expect(await waitForExit(pid)).toBe(true);
  });

  it('resolves a free port when the preferred port conflicts, then stops cleanly', async () => {
    const pids: number[] = [];
    const spawnArgs: string[][] = [];
    const recordingSpawn: SpawnFunction = (binary, args, options) => {
      spawnArgs.push(args);
      const child = nodeSpawn(binary, args, options);
      if (child.pid !== undefined) pids.push(child.pid);
      return child;
    };

    const notices: string[] = [];
    const manager = new ServerManager({
      resolveBinary: async () => conflictStubPath,
      port: 4567,
      cwd: here,
      projectDirectory: null,
      platform: process.platform,
      comSpec: undefined,
      spawn: recordingSpawn,
      taskkill: taskkillProcess,
      findAvailablePort: getAvailablePortNode,
    });
    manager.onNotice((msg) => notices.push(msg));

    await manager.start();

    expect(manager.getState()).toBe('running');
    const actualPort = manager.getPort();
    if (actualPort === null) throw new Error('manager did not report a port');
    expect(actualPort).not.toBe(4567);
    expect(manager.getUrl()).toBe(`http://127.0.0.1:${actualPort}`);
    expect(notices).toEqual([`Port 4567 is in use; using port ${actualPort}.`]);
    expect(spawnArgs[0]).toEqual(['serve', '--port', '4567', '--foreground']);
    expect(spawnArgs[1]).toEqual(['serve', '--port', String(actualPort), '--foreground']);

    expect(pids.length).toBe(2);
    const [pid1, pid2] = pids;
    if (pid1 === undefined || pid2 === undefined) throw new Error('expected two spawned pids');
    expect(await waitForExit(pid1)).toBe(true);
    expect(isAlive(pid2)).toBe(true);

    await manager.stop();

    expect(manager.getState()).toBe('stopped');
    expect(manager.getUrl()).toBeNull();
    expect(await waitForExit(pid2)).toBe(true);
  });
});
