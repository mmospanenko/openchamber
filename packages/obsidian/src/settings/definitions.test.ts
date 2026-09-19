import { describe, expect, it } from 'vitest';

import type { SettingDefinitionItem } from 'obsidian';

import { DEFAULT_SETTINGS } from '../types';
import { buildSettingDefinitions } from './definitions';

const definitionsWith = (autoStart: boolean) =>
  buildSettingDefinitions(() => ({ ...DEFAULT_SETTINGS, autoStart }));

const controlKey = (definition: SettingDefinitionItem): string | null =>
  'control' in definition && definition.control !== undefined ? definition.control.key : null;

const isVisible = (definition: SettingDefinitionItem): boolean => {
  if (!('visible' in definition)) return true;
  const visible = definition.visible;
  if (visible === undefined) return true;
  return visible instanceof Function ? visible() : visible;
};

describe('buildSettingDefinitions', () => {
  it('exposes executable path, port, auto-start, and external URL controls', () => {
    const keys = definitionsWith(true).map(controlKey);

    expect(keys).toEqual(['openchamberPath', 'port', 'autoStart', 'externalUrl']);
  });

  it('hides the external URL control while auto-start is enabled', () => {
    const external = definitionsWith(true).at(-1);
    if (external === undefined) throw new Error('external definition missing');

    expect(isVisible(external)).toBe(false);
  });

  it('shows the external URL control when auto-start is disabled', () => {
    const external = definitionsWith(false).at(-1);
    if (external === undefined) throw new Error('external definition missing');

    expect(isVisible(external)).toBe(true);
  });
});
