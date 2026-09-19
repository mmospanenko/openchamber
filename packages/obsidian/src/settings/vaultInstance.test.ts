import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildVaultInstanceSettings,
  createNodeVaultFileSystem,
  createProjectIdFromPath,
  deriveVaultDataDir,
  ensureVaultInstanceSettings,
} from './vaultInstance';

const createTempDir = async (): Promise<string> => mkdtemp(path.join(tmpdir(), 'oc-vault-instance-'));

describe('createProjectIdFromPath', () => {
  it('matches the server base64url project id', () => {
    const expected = `path_${Buffer.from('/notes', 'utf8').toString('base64url')}`;

    expect(createProjectIdFromPath('/notes')).toBe(expected);
  });

  it('normalizes backslashes and a trailing slash', () => {
    const expected = `path_${Buffer.from('/home/user/notes', 'utf8').toString('base64url')}`;

    expect(createProjectIdFromPath('\\home\\user\\notes\\')).toBe(expected);
  });

  it('returns an empty string for an empty path', () => {
    expect(createProjectIdFromPath('')).toBe('');
  });
});

describe('deriveVaultDataDir', () => {
  it('stays under the OpenChamber config root and is stable for one vault', () => {
    const first = deriveVaultDataDir({ homeDirectory: '/home/user', vaultPath: '/notes' });
    const second = deriveVaultDataDir({ homeDirectory: '/home/user', vaultPath: '/notes' });

    expect(first).toBe(second);
    expect(first.startsWith(path.join('/home/user', '.config', 'openchamber', 'obsidian-vaults'))).toBe(true);
  });

  it('separates two vaults', () => {
    const first = deriveVaultDataDir({ homeDirectory: '/home/user', vaultPath: '/notes' });
    const second = deriveVaultDataDir({ homeDirectory: '/home/user', vaultPath: '/other' });

    expect(first).not.toBe(second);
  });
});

describe('buildVaultInstanceSettings', () => {
  it('points lastDirectory and the active project at the vault', () => {
    const settings = buildVaultInstanceSettings({ vaultPath: '/notes', now: 1000 });
    const id = createProjectIdFromPath('/notes');

    expect(settings.lastDirectory).toBe('/notes');
    expect(settings.activeProjectId).toBe(id);
    expect(settings.projects).toEqual([
      { id, path: '/notes', addedAt: 1000, lastOpenedAt: 1000 },
    ]);
  });
});

describe('ensureVaultInstanceSettings', () => {
  it('seeds settings.json once when it is missing', async () => {
    const dataDir = path.join(await createTempDir(), 'nested', 'instance');
    const fileSystem = createNodeVaultFileSystem();

    const seeded = await ensureVaultInstanceSettings({
      fileSystem,
      dataDir,
      vaultPath: '/notes',
      now: 1000,
    });

    expect(seeded).toBe(true);
    const written = JSON.parse(await readFile(path.join(dataDir, 'settings.json'), 'utf8'));
    expect(written).toEqual(buildVaultInstanceSettings({ vaultPath: '/notes', now: 1000 }));
  });

  it('pre-creates the user folders so the server does not copy the default instance into the vault', async () => {
    const dataDir = path.join(await createTempDir(), 'instance');
    const fileSystem = createNodeVaultFileSystem();

    await ensureVaultInstanceSettings({ fileSystem, dataDir, vaultPath: '/notes', now: 1000 });

    const entries = await readdir(dataDir);
    expect(entries.sort()).toEqual(['projects', 'settings.json', 'speech-models', 'themes']);
  });

  it('does not overwrite an existing settings.json', async () => {
    const dataDir = await createTempDir();
    const settingsPath = path.join(dataDir, 'settings.json');
    await writeFile(settingsPath, JSON.stringify({ lastDirectory: '/chosen' }), 'utf8');
    const fileSystem = createNodeVaultFileSystem();

    const seeded = await ensureVaultInstanceSettings({
      fileSystem,
      dataDir,
      vaultPath: '/notes',
      now: 1000,
    });

    expect(seeded).toBe(false);
    expect(JSON.parse(await readFile(settingsPath, 'utf8'))).toEqual({ lastDirectory: '/chosen' });
  });
});
