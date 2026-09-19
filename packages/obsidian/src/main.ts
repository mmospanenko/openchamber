import { homedir } from 'node:os';
import path from 'node:path';

import { addIcon, FileSystemAdapter, Notice, Plugin, type WorkspaceLeaf } from 'obsidian';

import { OPENCHAMBER_ICON_ID, OPENCHAMBER_ICON_SVG } from './icon';
import { LABELS } from './labels';
import type { OpenChamberViewOptions } from './ui/OpenChamberView';
import { OpenChamberView } from './ui/OpenChamberView';
import {
  createNodeFileSystemProbes,
  resolveExecutable,
  resolveLoginShellPath,
  standardInstallDirectories,
} from './server/ExecutableResolver';
import {
  getAvailablePortNode,
  isPortAvailableNode,
  nodeSpawn,
  taskkillProcess,
} from './server/nodeSpawn';
import { ServerController } from './server/ServerController';
import type { ServerManagerOptions } from './server/ServerManager';
import { ServerManager } from './server/ServerManager';
import type { ServerState } from './server/types';
import { SettingsTab } from './settings/SettingsTab';
import { parseSettings } from './settings/parseSettings';
import {
  createNodeVaultFileSystem,
  deriveVaultDataDir,
  ensureVaultInstanceSettings,
} from './settings/vaultInstance';
import { OPENCHAMBER_VIEW_TYPE, DEFAULT_SETTINGS, type OpenChamberSettings } from './types';
import { resolveProjectDirectory } from './vault';

const STATUS_LABELS = {
  stopped: LABELS.statusStopped,
  starting: LABELS.statusStarting,
  running: LABELS.statusRunning,
  error: LABELS.statusError,
} satisfies Record<ServerState, string>;

export default class OpenChamberPlugin extends Plugin {
  private currentSettings: OpenChamberSettings = { ...DEFAULT_SETTINGS };
  private controller: ServerController | null = null;
  private statusBarEl: HTMLElement | null = null;
  private projectDirectory: string | null = null;
  private vaultDataDir: string | null = null;
  private loginShellPath = '';
  private fallbackDirectories: string[] = [];

  getSettings(): OpenChamberSettings {
    return this.currentSettings;
  }

  async setSettings(next: OpenChamberSettings): Promise<void> {
    this.currentSettings = next;
    await this.saveData(next);
  }

  override async onload(): Promise<void> {
    const data = await this.loadData();
    this.currentSettings = parseSettings(data);
    this.projectDirectory = await resolveProjectDirectory(this.getVaultAdapter());
    this.vaultDataDir = await this.resolveVaultDataDir();
    this.loginShellPath = resolveLoginShellPath(process.platform);
    this.fallbackDirectories = standardInstallDirectories(process.platform);

    this.statusBarEl = this.addStatusBarItem();
    this.updateStatusBar('stopped');

    this.controller = new ServerController({ createManager: () => this.createManager() });
    this.controller.onStateChange((state) => {
      this.updateStatusBar(state, this.controller?.getPort());
    });
    this.controller.onError((message) => {
      new Notice(message);
    });
    this.controller.onNotice((message) => {
      new Notice(message);
    });
    this.registerEvent(
      this.app.workspace.on('quit', () => {
        void this.controller?.stop();
      }),
    );

    addIcon(OPENCHAMBER_ICON_ID, OPENCHAMBER_ICON_SVG);

    this.registerView(OPENCHAMBER_VIEW_TYPE, (leaf) => this.createView(leaf));
    this.addRibbonIcon(OPENCHAMBER_ICON_ID, LABELS.ribbonOpen, () => {
      void this.activateView();
    });
    this.addCommand({
      id: 'open',
      name: LABELS.commandOpen,
      callback: () => {
        void this.activateView();
      },
    });
    this.addCommand({
      id: 'restart',
      name: LABELS.commandRestart,
      callback: () => {
        void this.restartServer();
      },
    });
    this.addCommand({
      id: 'stop',
      name: LABELS.commandStop,
      callback: () => {
        void this.stopServer();
      },
    });
    this.addSettingTab(new SettingsTab(this.app, this));

    await this.startIfConfigured();
  }

  override onunload(): void {
    void this.controller?.stop();
    this.controller = null;
  }

  private getVaultAdapter(): { getBasePath(): string } | null {
    const adapter = this.app.vault.adapter;
    return adapter instanceof FileSystemAdapter ? adapter : null;
  }

  private async resolveVaultDataDir(): Promise<string | null> {
    if (this.projectDirectory === null) return null;
    if (this.getExternalUrl() !== null) return null;
    const dataDir = deriveVaultDataDir({
      homeDirectory: homedir(),
      vaultPath: this.projectDirectory,
    });
    try {
      await ensureVaultInstanceSettings({
        fileSystem: createNodeVaultFileSystem(),
        dataDir,
        vaultPath: this.projectDirectory,
        now: Date.now(),
      });
    } catch {
      new Notice(LABELS.vaultDataDirUnavailable);
      return null;
    }
    return dataDir;
  }

  private createManager(): ServerManager {
    const settings = this.currentSettings;
    const options: ServerManagerOptions = {
      resolveBinary: () =>
        resolveExecutable({
          configuredPath: settings.openchamberPath,
          pathValue: process.env.PATH ?? '',
          loginShellPath: this.loginShellPath,
          fallbackDirectories: this.fallbackDirectories,
          platform: process.platform,
          pathDelimiter: path.delimiter,
          pathExt: process.env.PATHEXT ?? '',
          fileSystem: createNodeFileSystemProbes(),
        }),
      port: settings.port,
      cwd: this.projectDirectory ?? homedir(),
      projectDirectory: this.projectDirectory,
      dataDir: this.vaultDataDir ?? undefined,
      platform: process.platform,
      comSpec: process.env.ComSpec,
      spawn: nodeSpawn,
      taskkill: taskkillProcess,
      isPortAvailable: isPortAvailableNode,
      findAvailablePort: getAvailablePortNode,
    };
    return new ServerManager(options);
  }

  private createView(leaf: WorkspaceLeaf): OpenChamberView {
    const options: OpenChamberViewOptions = {
      source: this.requireController(),
      getExternalUrl: () => this.getExternalUrl(),
      labels: {
        viewTitle: LABELS.viewTitle,
        loading: LABELS.loading,
        stopped: LABELS.stopped,
        retry: LABELS.retry,
      },
    };
    return new OpenChamberView(leaf, options);
  }

  private getExternalUrl(): string | null {
    if (this.currentSettings.autoStart) return null;
    const externalUrl = this.currentSettings.externalUrl.trim();
    return externalUrl.length > 0 ? externalUrl : null;
  }

  private async startIfConfigured(): Promise<void> {
    if (this.getExternalUrl() !== null) return;
    if (!this.currentSettings.autoStart) return;
    if (this.projectDirectory === null) {
      new Notice(LABELS.vaultUnavailable);
    }
    await this.startServer();
  }

  private async startServer(): Promise<void> {
    await this.requireController().start().catch(() => undefined);
  }

  private async restartServer(): Promise<void> {
    await this.requireController().restart().catch(() => undefined);
  }

  private async stopServer(): Promise<void> {
    await this.requireController().stop();
  }

  private requireController(): ServerController {
    if (this.controller === null) throw new Error('OpenChamber server controller is not available');
    return this.controller;
  }

  private updateStatusBar(state: ServerState, port: number | null = null): void {
    if (state === 'running' && port !== null) {
      this.statusBarEl?.setText(LABELS.statusRunningWithPort(port));
      return;
    }
    this.statusBarEl?.setText(STATUS_LABELS[state]);
  }

  private ensureServerStarted(): void {
    if (this.getExternalUrl() !== null) return;
    if (this.requireController().getState() !== 'stopped') return;
    void this.startServer();
  }

  private async activateView(): Promise<void> {
    this.ensureServerStarted();
    const existing = this.app.workspace.getLeavesOfType(OPENCHAMBER_VIEW_TYPE);
    const first = existing[0];
    if (first !== undefined) {
      await this.app.workspace.revealLeaf(first);
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf === null) return;
    await leaf.setViewState({ type: OPENCHAMBER_VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }
}
