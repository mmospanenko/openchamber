import type { SettingDefinitionItem } from 'obsidian';

import { LABELS } from '../labels';
import type { OpenChamberSettings } from '../types';

type SettingsReader = () => OpenChamberSettings;

export const buildSettingDefinitions = (getSettings: SettingsReader): SettingDefinitionItem[] => [
  {
    name: LABELS.settingsOpenchamberPath,
    desc: LABELS.settingsOpenchamberPathDesc,
    control: {
      type: 'text',
      key: 'openchamberPath',
      placeholder: '/usr/local/bin/openchamber',
    },
  },
  {
    name: LABELS.settingsPort,
    desc: LABELS.settingsPortDesc,
    control: {
      type: 'number',
      key: 'port',
      min: 1,
      max: 65535,
      step: 1,
    },
  },
  {
    name: LABELS.settingsAutoStart,
    desc: LABELS.settingsAutoStartDesc,
    control: {
      type: 'toggle',
      key: 'autoStart',
    },
  },
  {
    name: LABELS.settingsExternalUrl,
    desc: LABELS.settingsExternalUrlDesc,
    visible: () => !getSettings().autoStart,
    control: {
      type: 'text',
      key: 'externalUrl',
      placeholder: 'https://example.com',
    },
  },
];
