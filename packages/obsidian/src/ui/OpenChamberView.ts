import { ItemView, type IconName, type WorkspaceLeaf } from 'obsidian';

import { OPENCHAMBER_ICON_ID } from '../icon';
import type { ServerState } from '../server/types';
import { OPENCHAMBER_VIEW_TYPE } from '../types';
import { renderStateFor, type RenderInstruction } from './renderState';

export interface OpenChamberViewSource {
  getState(): ServerState;
  getUrl(): string | null;
  getErrorMessage(): string | null;
  onStateChange(listener: (state: ServerState) => void): () => void;
  start(): Promise<void>;
}

export interface OpenChamberViewLabels {
  viewTitle: string;
  loading: string;
  stopped: string;
  retry: string;
}

export interface OpenChamberViewOptions {
  source: OpenChamberViewSource;
  getExternalUrl: () => string | null;
  labels: OpenChamberViewLabels;
}

export class OpenChamberView extends ItemView {
  private readonly options: OpenChamberViewOptions;
  private unsubscribe: (() => void) | null = null;

  constructor(leaf: WorkspaceLeaf, options: OpenChamberViewOptions) {
    super(leaf);
    this.options = options;
  }

  override getViewType(): string {
    return OPENCHAMBER_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return this.options.labels.viewTitle;
  }

  override getIcon(): IconName {
    return OPENCHAMBER_ICON_ID;
  }

  override async onOpen(): Promise<void> {
    this.unsubscribe = this.options.source.onStateChange(() => {
      this.render();
    });
    this.render();
  }

  override async onClose(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private render(): void {
    const container = this.contentEl;
    container.empty();
    const instruction = renderStateFor({
      state: this.options.source.getState(),
      serverUrl: this.options.source.getUrl(),
      externalUrl: this.options.getExternalUrl(),
      errorMessage: this.options.source.getErrorMessage(),
    });
    this.renderInstruction(container, instruction);
  }

  private renderInstruction(container: HTMLElement, instruction: RenderInstruction): void {
    if (instruction.kind === 'iframe' || instruction.kind === 'external') {
      container.createEl('iframe', {
        cls: 'openchamber-frame',
        attr: { src: instruction.url, title: this.options.labels.viewTitle },
      });
      return;
    }

    if (instruction.kind === 'error' || instruction.kind === 'stopped') {
      const isError = instruction.kind === 'error';
      const state = container.createDiv({
        cls: isError ? 'openchamber-state openchamber-error' : 'openchamber-state openchamber-stopped',
      });
      state.createDiv({
        cls: 'openchamber-error-message',
        text: isError
          ? instruction.message ?? this.options.labels.viewTitle
          : this.options.labels.stopped,
      });
      const retry = state.createEl('button', {
        cls: 'openchamber-retry',
        text: this.options.labels.retry,
      });
      retry.addEventListener('click', () => {
        void this.options.source.start().catch(() => undefined);
      });
      return;
    }

    const loading = container.createDiv({ cls: 'openchamber-state openchamber-loading' });
    loading.createDiv({ cls: 'openchamber-loading-indicator' });
    loading.createDiv({ cls: 'openchamber-loading-text', text: this.options.labels.loading });
  }
}
