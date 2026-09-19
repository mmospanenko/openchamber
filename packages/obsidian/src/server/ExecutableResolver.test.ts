import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ExecutableResolutionError,
  createNodeFileSystemProbes,
  parseEnvOutputPath,
  resolveExecutable,
  resolveLoginShellPath,
  resolveWindowsLaunchSpec,
  standardInstallDirectories,
  type FileSystemProbes,
  type ResolveExecutableOptions,
} from './ExecutableResolver';

interface ResolveOptionOverrides {
  configuredPath?: string;
  pathValue?: string;
  loginShellPath?: string;
  fallbackDirectories?: string[];
  platform?: NodeJS.Platform;
  pathDelimiter?: string;
  pathExt?: string;
  fileSystem?: FileSystemProbes;
}

const resolveOptions = (overrides: ResolveOptionOverrides): ResolveExecutableOptions => ({
  configuredPath: overrides.configuredPath ?? '',
  pathValue: overrides.pathValue ?? '',
  loginShellPath: overrides.loginShellPath ?? '',
  fallbackDirectories: overrides.fallbackDirectories ?? [],
  platform: overrides.platform ?? 'darwin',
  pathDelimiter: overrides.pathDelimiter ?? path.delimiter,
  pathExt: overrides.pathExt ?? '.EXE;.CMD;.BAT;.COM',
  fileSystem: overrides.fileSystem ?? createNodeFileSystemProbes(),
});

const createTempDir = async (): Promise<string> => mkdtemp(path.join(tmpdir(), 'oc-executable-'));

const writeExecutable = async (directory: string, name: string): Promise<string> => {
  const filePath = path.join(directory, name);
  await writeFile(filePath, '#!/bin/sh\nexit 0\n');
  await chmod(filePath, 0o755);
  return filePath;
};

describe('resolveExecutable', () => {
  it('uses a configured executable path and never searches PATH', async () => {
    const configuredDir = await createTempDir();
    const pathDir = await createTempDir();
    try {
      const configured = await writeExecutable(configuredDir, 'openchamber');
      await writeExecutable(pathDir, 'openchamber');

      const realProbes = createNodeFileSystemProbes();
      const probedTargets: string[] = [];
      const countingProbes: FileSystemProbes = {
        stat: (target) => {
          probedTargets.push(target);
          return realProbes.stat(target);
        },
        access: (target, mode) => {
          probedTargets.push(target);
          return realProbes.access(target, mode);
        },
        readdir: (target) => {
          probedTargets.push(target);
          return realProbes.readdir(target);
        },
      };

      const resolved = await resolveExecutable(
        resolveOptions({ configuredPath: configured, pathValue: pathDir, fileSystem: countingProbes }),
      );

      expect(resolved).toBe(configured);
      expect(probedTargets.some((target) => target.startsWith(pathDir))).toBe(false);
    } finally {
      await rm(configuredDir, { recursive: true, force: true });
      await rm(pathDir, { recursive: true, force: true });
    }
  });

  it('rejects a configured path that exists but is not executable, naming the path', async () => {
    const directory = await createTempDir();
    try {
      const notExecutable = path.join(directory, 'openchamber');
      await writeFile(notExecutable, 'plain text');
      await chmod(notExecutable, 0o644);

      await expect(
        resolveExecutable(resolveOptions({ configuredPath: notExecutable })),
      ).rejects.toBeInstanceOf(ExecutableResolutionError);
      await expect(
        resolveExecutable(resolveOptions({ configuredPath: notExecutable })),
      ).rejects.toThrowError(notExecutable);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('finds the executable in a PATH entry', async () => {
    const pathDir = await createTempDir();
    try {
      const expected = await writeExecutable(pathDir, 'openchamber');

      const resolved = await resolveExecutable(resolveOptions({ pathValue: pathDir }));

      expect(resolved).toBe(expected);
    } finally {
      await rm(pathDir, { recursive: true, force: true });
    }
  });

  it('returns null when the executable is nowhere', async () => {
    const pathDir = await createTempDir();
    try {
      const resolved = await resolveExecutable(resolveOptions({ pathValue: pathDir }));

      expect(resolved).toBeNull();
    } finally {
      await rm(pathDir, { recursive: true, force: true });
    }
  });

  it('skips a PATH candidate whose access probe errors', async () => {
    const pathDir = await createTempDir();
    try {
      await writeExecutable(pathDir, 'openchamber');

      const realProbes = createNodeFileSystemProbes();
      const failingProbes: FileSystemProbes = {
        stat: (target) => realProbes.stat(target),
        access: () => Promise.reject(new Error('EACCES: permission denied')),
        readdir: (target) => realProbes.readdir(target),
      };

      const resolved = await resolveExecutable(
        resolveOptions({ pathValue: pathDir, fileSystem: failingProbes }),
      );

      expect(resolved).toBeNull();
    } finally {
      await rm(pathDir, { recursive: true, force: true });
    }
  });

  it('finds the executable through the login-shell PATH when the process PATH misses it', async () => {
    const shellDir = await createTempDir();
    const emptyDir = await createTempDir();
    try {
      const expected = await writeExecutable(shellDir, 'openchamber');

      const resolved = await resolveExecutable(
        resolveOptions({ pathValue: emptyDir, loginShellPath: shellDir }),
      );

      expect(resolved).toBe(expected);
    } finally {
      await rm(shellDir, { recursive: true, force: true });
      await rm(emptyDir, { recursive: true, force: true });
    }
  });

  it('finds the executable in a standard installation directory', async () => {
    const directory = await createTempDir();
    try {
      const expected = await writeExecutable(directory, 'openchamber');

      const resolved = await resolveExecutable(
        resolveOptions({ fallbackDirectories: [directory] }),
      );

      expect(resolved).toBe(expected);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('prefers the process PATH over the login-shell PATH', async () => {
    const pathDir = await createTempDir();
    const shellDir = await createTempDir();
    try {
      const fromPath = await writeExecutable(pathDir, 'openchamber');
      await writeExecutable(shellDir, 'openchamber');

      const resolved = await resolveExecutable(
        resolveOptions({ pathValue: pathDir, loginShellPath: shellDir }),
      );

      expect(resolved).toBe(fromPath);
    } finally {
      await rm(pathDir, { recursive: true, force: true });
      await rm(shellDir, { recursive: true, force: true });
    }
  });

  it('matches PATHEXT-suffixed files when resolving for Windows', async () => {
    const pathDir = await createTempDir();
    try {
      const expected = await writeExecutable(pathDir, 'openchamber.cmd');

      const resolved = await resolveExecutable(
        resolveOptions({ pathValue: pathDir, platform: 'win32', pathDelimiter: ';', pathExt: '.EXE;.CMD' }),
      );

      expect(resolved).toBe(expected);
    } finally {
      await rm(pathDir, { recursive: true, force: true });
    }
  });
});

describe('parseEnvOutputPath', () => {
  it('extracts PATH from a null-separated env dump', () => {
    const dump = 'HOME=/home/u\0PATH=/a/bin:/b/bin\0SHELL=/bin/zsh\0';

    expect(parseEnvOutputPath(dump)).toBe('/a/bin:/b/bin');
  });

  it('falls back to newline separation when no null bytes are present', () => {
    const dump = 'HOME=/home/u\nPATH=/a/bin\n';

    expect(parseEnvOutputPath(dump)).toBe('/a/bin');
  });

  it('returns null when the dump has no PATH', () => {
    expect(parseEnvOutputPath('HOME=/home/u\0SHELL=/bin/zsh\0')).toBeNull();
  });
});

describe('resolveLoginShellPath', () => {
  it('returns the PATH from the first shell that answers', () => {
    const probed: string[] = [];
    const path_value = resolveLoginShellPath('darwin', (shell, args) => {
      probed.push(`${shell} ${args.join(' ')}`);
      return `SHELL=${shell}\0PATH=/probed/bin\n`;
    });

    expect(path_value).toBe('/probed/bin');
    expect(probed.length).toBe(1);
    expect(probed[0]).toContain('-lic env');
  });

  it('tries the next shell when one yields no PATH', () => {
    const probed: string[] = [];
    const path_value = resolveLoginShellPath('darwin', (shell) => {
      probed.push(shell);
      return shell === '/bin/zsh' ? 'HOME=/u\0' : 'HOME=/u\0PATH=/fallback/bin\0';
    });

    expect(path_value).toBe('/fallback/bin');
    expect(probed.length).toBeGreaterThan(1);
  });

  it('returns an empty string on Windows without probing', () => {
    let calls = 0;
    const path_value = resolveLoginShellPath('win32', () => {
      calls += 1;
      return 'PATH=/x\0';
    });

    expect(path_value).toBe('');
    expect(calls).toBe(0);
  });
});

describe('standardInstallDirectories', () => {
  it('includes the common POSIX install locations', () => {
    const directories = standardInstallDirectories('darwin', '/home/u');

    expect(directories).toContain('/usr/local/bin');
    expect(directories).toContain('/opt/homebrew/bin');
    expect(directories).toContain('/home/u/.opencode/bin');
    expect(directories).toContain('/home/u/.bun/bin');
  });

  it('includes the common Windows install locations', () => {
    const directories = standardInstallDirectories('win32', 'C:\\Users\\u');

    expect(directories.some((directory) => directory.includes('npm'))).toBe(true);
    expect(directories.some((directory) => directory.includes('scoop'))).toBe(true);
  });
});

describe('resolveWindowsLaunchSpec', () => {
  it('launches a batch shim through the command processor', () => {
    const spec = resolveWindowsLaunchSpec(
      'C:\\Program Files\\nodejs\\openchamber.cmd',
      ['serve'],
      { platform: 'win32', comSpec: 'C:\\Windows\\System32\\cmd.exe' },
    );

    expect(spec).toEqual({
      binary: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/s', '/c', 'call', 'C:\\Program Files\\nodejs\\openchamber.cmd', 'serve'],
    });
  });

  it('launches a bare name through the command processor', () => {
    const spec = resolveWindowsLaunchSpec('openchamber', ['serve'], {
      platform: 'win32',
      comSpec: 'C:\\Windows\\System32\\cmd.exe',
    });

    expect(spec).toEqual({
      binary: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/s', '/c', 'call', 'openchamber', 'serve'],
    });
  });

  it('leaves an explicit executable untouched', () => {
    const spec = resolveWindowsLaunchSpec('C:\\tools\\openchamber.exe', ['serve'], {
      platform: 'win32',
      comSpec: 'C:\\Windows\\System32\\cmd.exe',
    });

    expect(spec).toEqual({ binary: 'C:\\tools\\openchamber.exe', args: ['serve'] });
  });

  it('leaves the spec untouched off Windows', () => {
    const spec = resolveWindowsLaunchSpec('/usr/local/bin/openchamber', ['serve'], {
      platform: 'darwin',
      comSpec: undefined,
    });

    expect(spec).toEqual({ binary: '/usr/local/bin/openchamber', args: ['serve'] });
  });
});
