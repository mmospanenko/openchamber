import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveProjectDirectory } from './vault';

const createTempDir = async (): Promise<string> => mkdtemp(path.join(tmpdir(), 'oc-vault-'));

describe('resolveProjectDirectory', () => {
  it('returns the vault base path when it is an existing directory', async () => {
    const base = await createTempDir();
    try {
      const resolved = await resolveProjectDirectory({ getBasePath: () => base });

      expect(resolved).toBe(base);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it('returns null when the adapter has no base path', async () => {
    const resolved = await resolveProjectDirectory(null);

    expect(resolved).toBeNull();
  });

  it('returns null when the base path is empty', async () => {
    const resolved = await resolveProjectDirectory({ getBasePath: () => '' });

    expect(resolved).toBeNull();
  });

  it('returns null when the base path does not exist', async () => {
    const resolved = await resolveProjectDirectory({
      getBasePath: () => path.join(tmpdir(), 'oc-vault-does-not-exist-12345'),
    });

    expect(resolved).toBeNull();
  });
});
