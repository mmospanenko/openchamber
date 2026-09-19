import { PluginSettingTab, type App, type Plugin, type SettingDefinitionItem } from 'obsidian';

import type { JsonValue, OpenChamberSettings } from '../types';
import { buildSettingDefinitions } from './definitions';
import { applySetting } from './parseSettings';

export interface OpenChamberSettingsHost extends Plugin {
  getSettings(): OpenChamberSettings;
  setSettings(next: OpenChamberSettings): Promise<void>;
}

export class SettingsTab extends PluginSettingTab {
  private readonly host: OpenChamberSettingsHost;

  constructor(app: App, plugin: OpenChamberSettingsHost) {
    super(app, plugin);
    this.host = plugin;
  }

  override getSettingDefinitions(): SettingDefinitionItem[] {
    return buildSettingDefinitions(() => this.host.getSettings());
  }

  override getControlValue(key: string): JsonValue {
    const settings = this.host.getSettings();
    if (key === 'openchamberPath') return settings.openchamberPath;
    if (key === 'port') return settings.port;
    if (key === 'autoStart') return settings.autoStart;
    if (key === 'externalUrl') return settings.externalUrl;
    return null;
  }

  override setControlValue(key: string, value: JsonValue): void {
    const next = applySetting(this.host.getSettings(), key, value);
    void this.host.setSettings(next).then(() => {
      this.update();
    });
  }
}
