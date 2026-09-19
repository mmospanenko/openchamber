import { stat } from 'node:fs/promises';

interface VaultBasePathAdapter {
  getBasePath(): string;
}

const isDirectory = async (target: string): Promise<boolean> => {
  try {
    const info = await stat(target);
    return info.isDirectory();
  } catch {
    return false;
  }
};

export const resolveProjectDirectory = async (
  adapter: VaultBasePathAdapter | null,
): Promise<string | null> => {
  if (adapter === null) return null;
  const basePath = adapter.getBasePath();
  if (basePath.trim().length === 0) return null;
  return (await isDirectory(basePath)) ? basePath : null;
};
