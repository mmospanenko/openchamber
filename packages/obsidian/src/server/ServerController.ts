import { ServerManager } from './ServerManager';
import type { ServerState } from './types';

export interface ServerControllerOptions {
  createManager: () => ServerManager;
}

type StateListener = (state: ServerState) => void;
type ErrorListener = (message: string) => void;
type NoticeListener = (message: string) => void;

export class ServerController {
  private readonly createManager: () => ServerManager;
  private readonly stateListeners = new Set<StateListener>();
  private readonly errorListeners = new Set<ErrorListener>();
  private readonly noticeListeners = new Set<NoticeListener>();

  private manager: ServerManager | null = null;
  private unsubscribeState: (() => void) | null = null;
  private unsubscribeError: (() => void) | null = null;
  private unsubscribeNotice: (() => void) | null = null;

  constructor(options: ServerControllerOptions) {
    this.createManager = options.createManager;
  }

  getState(): ServerState {
    return this.manager?.getState() ?? 'stopped';
  }

  getUrl(): string | null {
    return this.manager?.getUrl() ?? null;
  }

  getPort(): number | null {
    return this.manager?.getPort() ?? null;
  }

  getErrorMessage(): string | null {
    return this.manager?.getErrorMessage() ?? null;
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
    await this.disposeManager();
    const manager = this.createManager();
    this.manager = manager;
    this.unsubscribeState = manager.onStateChange((state) => {
      for (const listener of this.stateListeners) listener(state);
    });
    this.unsubscribeError = manager.onError((message) => {
      for (const listener of this.errorListeners) listener(message);
    });
    this.unsubscribeNotice = manager.onNotice((message) => {
      for (const listener of this.noticeListeners) listener(message);
    });
    await manager.start();
  }

  async stop(): Promise<void> {
    await this.disposeManager();
    for (const listener of this.stateListeners) listener('stopped');
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  private async disposeManager(): Promise<void> {
    this.unsubscribeState?.();
    this.unsubscribeError?.();
    this.unsubscribeNotice?.();
    this.unsubscribeState = null;
    this.unsubscribeError = null;
    this.unsubscribeNotice = null;
    const manager = this.manager;
    this.manager = null;
    if (manager !== null) {
      await manager.stop();
    }
  }
}
