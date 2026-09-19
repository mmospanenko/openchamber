import { execFile, spawn } from 'node:child_process';
import net from 'node:net';

import type {
  ChildProcessLike,
  PortProbeFunction,
  ReadableLike,
  SpawnFunction,
  SpawnOptionsLike,
  TaskkillFunction,
} from './ServerManager';

const toReadable = (stream: NodeJS.ReadableStream | null): ReadableLike | null =>
  stream === null
    ? null
    : {
        on: (_event, listener) => {
          stream.on('data', listener);
        },
      };

export const nodeSpawn: SpawnFunction = (
  binary: string,
  args: string[],
  options: SpawnOptionsLike,
): ChildProcessLike => {
  const child = spawn(binary, args, {
    cwd: options.cwd,
    env: options.env,
    windowsHide: options.windowsHide,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    pid: child.pid,
    stdout: toReadable(child.stdout),
    stderr: toReadable(child.stderr),
    onExit: (listener) => {
      child.on('exit', listener);
    },
    onError: (listener) => {
      child.on('error', listener);
    },
    kill: (signal) => child.kill(signal),
  };
};

export const taskkillProcess: TaskkillFunction = (pid, force) =>
  new Promise<void>((resolve) => {
    const args = force ? ['/pid', String(pid), '/f', '/t'] : ['/pid', String(pid), '/t'];
    execFile('taskkill', args, { windowsHide: true, timeout: force ? 5000 : 3000 }, () => {
      resolve();
    });
  });

export const isPortAvailableNode: PortProbeFunction = async (port: number): Promise<boolean> => {
  if (!Number.isFinite(port) || port <= 0) return false;
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.on('error', () => resolve(false));
    server.listen({ port, host: '127.0.0.1' }, () => {
      server.close(() => resolve(true));
    });
  });
};

export const getAvailablePortNode = async (): Promise<number> => {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.on('error', () => resolve(0));
    server.listen({ port: 0, host: '127.0.0.1' }, () => {
      const address = server.address();
      const port = address !== null && address instanceof Object ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
};
