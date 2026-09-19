import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS } from '../types';
import { parseSettings } from './parseSettings';

describe('parseSettings', () => {
  it('returns defaults for a null payload', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('returns defaults for a non-object payload', () => {
    expect(parseSettings('not settings')).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid fields and falls back only for missing ones', () => {
    const parsed = parseSettings({ openchamberPath: '/usr/local/bin/openchamber', port: 8080 });

    expect(parsed).toEqual({
      openchamberPath: '/usr/local/bin/openchamber',
      port: 8080,
      autoStart: DEFAULT_SETTINGS.autoStart,
      externalUrl: DEFAULT_SETTINGS.externalUrl,
    });
  });

  it('replaces wrong-typed fields with defaults', () => {
    const parsed = parseSettings({
      openchamberPath: 42,
      port: '3000',
      autoStart: 'yes',
      externalUrl: false,
    });

    expect(parsed).toEqual(DEFAULT_SETTINGS);
  });

  it('rejects a port outside the valid range', () => {
    expect(parseSettings({ port: 0 })).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({ port: 70000 })).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({ port: 3.5 })).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps a fully valid payload unchanged', () => {
    const valid = {
      openchamberPath: '/opt/openchamber',
      port: 65535,
      autoStart: false,
      externalUrl: 'https://remote.example.com',
    };

    expect(parseSettings(valid)).toEqual(valid);
  });
});
