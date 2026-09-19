import path from 'node:path';

import { LABELS } from '../labels';
import { resolveWindowsLaunchSpec } from './ExecutableResolver';
import type { ServerState } from './types';

const DEFAULT_READY_TIMEOUT_MS = 15_000;
const DEFAULT_TERMINATE_GRACE_MS = 2_500;

const READY_LINE_PATTERN = /listening on (.+):(\d+)/;

const PORT_CONFLICT_PATTERNS = [
  /already in use/i,
  /address already in use/i,
  /port .* in use/i,
  /port .* is used by/i,
  /already running on port/i,
  /already running/i,
  /used by .* openchamber/i,
  /eaddrinuse/i,
];

const isPortConflict = (message: string): boolean => {
  return PORT_CONFLICT_PATTERNS.some((pattern) => pattern.test(message));
};

export interface ReadableLike {
  on(event: 'data', listener: (chunk: Buffer) => void): void;
}

export type ExitListener = (code: number | null, signal: NodeJS.Signals | null) => void;
export type ChildErrorListener = (error: Error) => void;

export interface ChildProcessLike {
  pid?: number;
  stdout: ReadableLike | null;
  stderr: ReadableLike | null;
  onExit(listener: ExitListener): void;
  onError(listener: ChildErrorListener): void;
  kill(signal?: NodeJS.Signals | number): boolean;
}

export interface SpawnOptionsLike {
  cwd: string;
  env: NodeJS.ProcessEnv;
  windowsHide: boolean;
}

export type SpawnFunction = (
  binary: string,
  args: string[],
  options: SpawnOptionsLike,
) => ChildProcessLike;

export type TaskkillFunction = (pid: number, force: boolean) => Promise<void>;
export type PortProbeFunction = (port: number) => Promise<boolean>;
export type PortResolverFunction = () => Promise<number>;

export interface ServerManagerOptions {
  resolveBinary: () => Promise<string | null>;
  port: number;
  cwd: string;
  projectDirectory: string | null;
  dataDir?: string;
  platform: NodeJS.Platform;
  comSpec: string | undefined;
  spawn: SpawnFunction;
  taskkill: TaskkillFunction;
  isPortAvailable?: PortProbeFunction;
  findAvailablePort?: PortResolverFunction;
  readyTimeoutMs?: number;
  terminateGraceMs?: number;
}

type StateListener = (state: ServerState) => void;
type ErrorListener = (message: string) => void;
type NoticeListener = (message: string) => void;

interface ReadyResult {
  host: string;
  port: number;
}

type AttemptOutcome =
  | { ok: true; ready: ReadyResult }
  | { ok: false; error: Error };

export class ServerManager {
  private readonly options: ServerManagerOptions;
  private readonly readyTimeoutMs: number;
  private readonly terminateGraceMs: number;
  private readonly stateListeners = new Set<StateListener>();
  private readonly errorListeners = new Set<ErrorListener>();
  private readonly noticeListeners = new Set<NoticeListener>();

  private state: ServerState = 'stopped';
  private child: ChildProcessLike | null = null;
  private url: string | null = null;
  private port: number | null = null;
  private lastError: string | null = null;
  private stopping = false;
  private startToken = 0;
  private closedResolver: (() => void) | null = null;
  private closed: Promise<void> = Promise.resolve();

  constructor(options: ServerManagerOptions) {
    this.options = options;
    this.readyTimeoutMs = options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
    this.terminateGraceMs = options.terminateGraceMs ?? DEFAULT_TERMINATE_GRACE_MS;
  }

  getState(): ServerState {
    return this.state;
  }

  getUrl(): string | null {
    return this.url;
  }

  getPort(): number | null {
    return this.port;
  }

  getErrorMessage(): string | null {
    return this.lastError;
  }

  onStateChange(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  onError(listener: ErrorListener): () => void {
    this.errorListeners.add(listener);
    return () => {
      this.errorListeners.delete(listener);
    };
  }

  onNotice(listener: NoticeListener): () => void {
    this.noticeListeners.add(listener);
    return () => {
      this.noticeListeners.delete(listener);
    };
  }

  async start(): Promise<void> {
    if (this.state === 'running' || this.state === 'starting') return;

    this.stopping = false;
    const token = (this.startToken += 1);
    this.url = null;
    this.port = null;
    this.lastError = null;
    this.setState('starting');

    let binary: string | null;
    try {
      binary = await this.options.resolveBinary();
    } catch (error) {
      if (token !== this.startToken) return;
      const failure = error instanceof Error ? error : new Error(String(error));
      this.failWith(failure);
      throw failure;
    }
    if (token !== this.startToken) return;
    if (binary === null) {
      const error = new Error('OpenChamber executable not found');
      this.failWith(error);
      throw error;
    }

    let portAvailable = true;
    if (this.options.isPortAvailable !== undefined) {
      try {
        portAvailable = await this.options.isPortAvailable(this.options.port);
      } catch {
        portAvailable = true;
      }
    }
    if (token !== this.startToken) return;

    let initialArgs: string[];
    if (portAvailable) {
      initialArgs = ['serve', '--port', String(this.options.port), '--foreground'];
    } else if (this.options.findAvailablePort !== undefined) {
      const fallbackPort = await this.options.findAvailablePort();
      initialArgs = fallbackPort > 0
        ? ['serve', '--port', String(fallbackPort), '--foreground']
        : ['serve', '--foreground'];
    } else {
      initialArgs = ['serve', '--foreground'];
    }
    const initialChild = this.spawnChild(binary, initialArgs);
    let outcome = await this.monitor(initialChild);
    if (token !== this.startToken) return;

    if (!outcome.ok && portAvailable && isPortConflict(outcome.error.message)) {
      await this.terminate();
      this.child = null;
      if (token !== this.startToken || this.stopping) return;

      let fallbackArgs: string[];
      if (this.options.findAvailablePort !== undefined) {
        const fallbackPort = await this.options.findAvailablePort();
        fallbackArgs = fallbackPort > 0
          ? ['serve', '--port', String(fallbackPort), '--foreground']
          : ['serve', '--foreground'];
      } else {
        fallbackArgs = ['serve', '--foreground'];
      }
      const fallbackChild = this.spawnChild(binary, fallbackArgs);
      outcome = await this.monitor(fallbackChild);
      if (token !== this.startToken) return;
    }

    if (!outcome.ok) {
      await this.terminate();
      this.child = null;
      this.failWith(outcome.error);
      throw outcome.error;
    }
    if (this.stopping) return;

    this.port = outcome.ready.port;
    this.url = this.toUrl(outcome.ready.host, outcome.ready.port);
    if (outcome.ready.port !== this.options.port) {
      this.notify(LABELS.portReassigned(this.options.port, outcome.ready.port));
    }
    this.setState('running');
  }

  async stop(): Promise<void> {
    this.startToken += 1;
    if (this.child === null) {
      this.url = null;
      this.port = null;
      this.setState('stopped');
      return;
    }

    this.stopping = true;
    await this.terminate();
    this.child = null;
    this.url = null;
    this.port = null;
    this.setState('stopped');
  }

  private spawnChild(binary: string, args: string[]): ChildProcessLike {
    const launch = resolveWindowsLaunchSpec(
      binary,
      args,
      { platform: this.options.platform, comSpec: this.options.comSpec },
    );

    const env = this.buildChildEnv(binary);
    if (this.options.projectDirectory !== null) {
      env.OPENCHAMBER_OPENCODE_CWD = this.options.projectDirectory;
    }
    if (this.options.dataDir !== undefined) {
      env.OPENCHAMBER_DATA_DIR = this.options.dataDir;
    }

    const child = this.options.spawn(launch.binary, launch.args, {
      cwd: this.options.cwd,
      env,
      windowsHide: true,
    });
    this.child = child;
    this.closed = new Promise<void>((resolve) => {
      this.closedResolver = resolve;
    });
    return child;
  }

  private notify(message: string): void {
    for (const listener of this.noticeListeners) listener(message);
  }

  private buildChildEnv(binary: string): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env };
    const directory = path.dirname(binary);
    const current = env.PATH ?? '';
    const parts = current.split(path.delimiter).filter((segment) => segment.length > 0);
    if (!parts.includes(directory)) {
      env.PATH = [directory, ...parts].join(path.delimiter);
    }
    return env;
  }

  private monitor(child: ChildProcessLike): Promise<AttemptOutcome> {
    return new Promise<AttemptOutcome>((resolve) => {
      let settled = false;
      let stdoutBuffer = '';
      let stderrBuffer = '';

      const markClosed = (): void => {
        this.closedResolver?.();
        this.closedResolver = null;
      };

      const describeFailure = (base: string): string => {
        const line = stderrBuffer
          .split('\n')
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0)
          .at(-1);
        return line === undefined ? base : `${base}: ${line}`;
      };

      function finish(outcome: AttemptOutcome): void {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(outcome);
      }

      const timer = setTimeout(() => {
        finish({
          ok: false,
          error: new Error(
            describeFailure(
              `OpenChamber server did not report ready within ${this.readyTimeoutMs}ms`,
            ),
          ),
        });
      }, this.readyTimeoutMs);

      child.onExit((code, signal) => {
        markClosed();
        const detail = signal !== null ? `signal ${signal}` : `code ${code ?? 'unknown'}`;
        if (!settled) {
          if (this.stopping) {
            finish({ ok: true, ready: { host: '127.0.0.1', port: this.options.port } });
            return;
          }
          finish({
            ok: false,
            error: new Error(
              describeFailure(`OpenChamber server exited before it was ready (${detail})`),
            ),
          });
          return;
        }
        if (this.stopping || this.state !== 'running') return;
        this.url = null;
        this.port = null;
        this.child = null;
        this.failWith(
          new Error(describeFailure(`OpenChamber server exited unexpectedly (${detail})`)),
        );
      });

      child.stderr?.on('data', (chunk) => {
        stderrBuffer = `${stderrBuffer}${chunk.toString()}`.slice(-2000);
      });

      child.onError((error) => {
        if (!settled) {
          finish({ ok: false, error });
          return;
        }
        if (this.stopping || this.state !== 'running') return;
        this.url = null;
        this.port = null;
        this.child = null;
        this.failWith(error);
      });

      child.stdout?.on('data', (chunk) => {
        if (settled) return;
        stdoutBuffer += chunk.toString();
        const lines = stdoutBuffer.split('\n');
        stdoutBuffer = lines.pop() ?? '';
        for (const line of lines) {
          const match = line.match(READY_LINE_PATTERN);
          if (match === null) continue;
          const port = Number.parseInt(match[2], 10);
          finish({ ok: true, ready: { host: match[1], port } });
          return;
        }
      });
    });
  }

  private async terminate(): Promise<void> {
    const child = this.child;
    if (child === null || child.pid === undefined) return;

    if (this.options.platform === 'win32') {
      await this.options.taskkill(child.pid, false);
      if (!(await this.waitForClose())) {
        await this.options.taskkill(child.pid, true);
      }
      return;
    }

    try {
      child.kill('SIGTERM');
    } catch {
      return;
    }
    if (!(await this.waitForClose())) {
      try {
        child.kill('SIGKILL');
      } catch {
        return;
      }
      await this.waitForClose();
    }
  }

  private waitForClose(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), this.terminateGraceMs);
      void this.closed.then(() => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  }

  private toUrl(host: string, port: number): string {
    const displayHost = host === '0.0.0.0' || host === '::' || host === '[::]' ? '127.0.0.1' : host;
    return `http://${displayHost}:${port}`;
  }

  private setState(state: ServerState): void {
    if (this.state === state) return;
    this.state = state;
    for (const listener of this.stateListeners) listener(state);
  }

  private failWith(error: Error): void {
    this.lastError = error.message;
    this.setState('error');
    for (const listener of this.errorListeners) listener(error.message);
  }
}
