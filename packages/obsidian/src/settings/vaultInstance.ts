import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

interface VaultProjectEntry {
  id: string;
  path: string;
  addedAt: number;
  lastOpenedAt: number;
}

interface VaultInstanceSettings {
  lastDirectory: string;
  projects: VaultProjectEntry[];
  activeProjectId: string;
}

interface VaultFileSystem {
  readFile(target: string): Promise<string | null>;
  writeFile(target: string, data: string): Promise<void>;
  ensureDir(target: string): Promise<void>;
}

const USER_FOLDER_NAMES = ['projects', 'themes', 'speech-models'] as const;

export const createNodeVaultFileSystem = (): VaultFileSystem => ({
  readFile: async (target) => {
    try {
      return await readFile(target, 'utf8');
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  },
  writeFile: async (target, data) => {
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data, 'utf8');
  },
  ensureDir: async (target) => {
    await mkdir(target, { recursive: true });
  },
});

export const createProjectIdFromPath = (projectPath: string): string => {
  const normalized = projectPath.replace(/\\/g, '/').replace(/\/+$/g, '').trim();
  if (normalized.length === 0) return '';
  return `path_${Buffer.from(normalized, 'utf8').toString('base64url')}`;
};

const vaultDataDirName = (vaultPath: string): string =>
  createHash('sha256').update(vaultPath, 'utf8').digest('hex').slice(0, 16);

export const deriveVaultDataDir = (input: { homeDirectory: string; vaultPath: string }): string =>
  path.join(input.homeDirectory, '.config', 'openchamber', 'obsidian-vaults', vaultDataDirName(input.vaultPath));

export const buildVaultInstanceSettings = (input: { vaultPath: string; now: number }): VaultInstanceSettings => {
  const id = createProjectIdFromPath(input.vaultPath);
  return {
    lastDirectory: input.vaultPath,
    projects: [{ id, path: input.vaultPath, addedAt: input.now, lastOpenedAt: input.now }],
    activeProjectId: id,
  };
};

export const ensureVaultInstanceSettings = async (input: {
  fileSystem: VaultFileSystem;
  dataDir: string;
  vaultPath: string;
  now: number;
}): Promise<boolean> => {
  await Promise.all(
    USER_FOLDER_NAMES.map((name) => input.fileSystem.ensureDir(path.join(input.dataDir, name))),
  );
  const settingsPath = path.join(input.dataDir, 'settings.json');
  const existing = await input.fileSystem.readFile(settingsPath);
  if (existing !== null) return false;
  const settings = buildVaultInstanceSettings({ vaultPath: input.vaultPath, now: input.now });
  await input.fileSystem.writeFile(settingsPath, JSON.stringify(settings, null, 2));
  return true;
};
