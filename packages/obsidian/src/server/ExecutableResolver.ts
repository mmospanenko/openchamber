import { spawnSync } from 'node:child_process';
import { constants } from 'node:fs';
import { access, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

const OPENCHAMBER_BINARY = 'openchamber';
const WINDOWS_EXECUTABLE_EXTENSIONS = ['.exe', '.cmd', '.bat', '.com'];
const SHELL_PROBE_TIMEOUT_MS = 5000;

export class ExecutableResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExecutableResolutionError';
  }
}

export interface FileStat {
  isFile(): boolean;
}

export interface FileSystemProbes {
  stat(target: string): Promise<FileStat>;
  access(target: string, mode: number): Promise<void>;
  readdir(target: string): Promise<string[]>;
}

export const createNodeFileSystemProbes = (): FileSystemProbes => ({
  stat: (target) => stat(target),
  access: async (target, mode) => {
    await access(target, mode);
  },
  readdir: (target) => readdir(target),
});

export interface ResolveExecutableOptions {
  configuredPath: string;
  pathValue: string;
  loginShellPath: string;
  fallbackDirectories: string[];
  platform: NodeJS.Platform;
  pathDelimiter: string;
  pathExt: string;
  fileSystem: FileSystemProbes;
}

interface LaunchSpec {
  binary: string;
  args: string[];
}

interface WindowsLaunchSpecOptions {
  platform: NodeJS.Platform;
  comSpec: string | undefined;
}

const parseWindowsExtensions = (pathExt: string): string[] =>
  pathExt
    .split(';')
    .map((extension) => extension.trim().toLowerCase())
    .filter((extension) => extension.length > 0)
    .map((extension) => (extension.startsWith('.') ? extension : `.${extension}`));

const isWindowsExecutablePath = (target: string): boolean => {
  const extension = path.extname(target).toLowerCase();
  return extension.length === 0 || WINDOWS_EXECUTABLE_EXTENSIONS.includes(extension);
};

const isExecutableFile = async (
  target: string,
  options: ResolveExecutableOptions,
): Promise<boolean> => {
  let info: FileStat | null = null;
  try {
    info = await options.fileSystem.stat(target);
  } catch {
    return false;
  }
  if (!info.isFile()) return false;
  if (options.platform === 'win32') return isWindowsExecutablePath(target);
  try {
    await options.fileSystem.access(target, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

const resolveConfiguredPath = async (
  configuredPath: string,
  options: ResolveExecutableOptions,
): Promise<string> => {
  const executable = await isExecutableFile(configuredPath, options);
  if (executable) return configuredPath;
  throw new ExecutableResolutionError(
    `Configured OpenChamber executable is not a runnable file: ${configuredPath}`,
  );
};

const findInPathEntry = async (
  directory: string,
  options: ResolveExecutableOptions,
): Promise<string | null> => {
  if (options.platform !== 'win32') {
    const candidate = path.join(directory, OPENCHAMBER_BINARY);
    return (await isExecutableFile(candidate, options)) ? candidate : null;
  }

  let entries: string[];
  try {
    entries = await options.fileSystem.readdir(directory);
  } catch {
    return null;
  }
  for (const extension of parseWindowsExtensions(options.pathExt)) {
    const expected = `${OPENCHAMBER_BINARY}${extension}`.toLowerCase();
    const match = entries.find((entry) => entry.toLowerCase() === expected);
    if (match === undefined) continue;
    const candidate = path.join(directory, match);
    if (await isExecutableFile(candidate, options)) return candidate;
  }
  return null;
};

type ShellProbe = (shell: string, args: string[]) => string | null;

const defaultShellProbe: ShellProbe = (shell, args) => {
  const result = spawnSync(shell, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 10 * 1024 * 1024,
    windowsHide: true,
    timeout: SHELL_PROBE_TIMEOUT_MS,
  });
  return result.status === 0 ? result.stdout : null;
};

export const resolveLoginShellPath = (
  platform: NodeJS.Platform,
  shellProbe: ShellProbe = defaultShellProbe,
): string => {
  if (platform === 'win32') return '';
  const candidates = [process.env.SHELL, '/bin/zsh', '/bin/bash', '/bin/sh'].map(
    (candidate) => candidate ?? '',
  );
  const seen = new Set<string>();
  for (const shell of candidates) {
    if (shell.length === 0 || seen.has(shell)) continue;
    seen.add(shell);
    const output = shellProbe(shell, ['-lic', 'env -0']);
    if (output === null) continue;
    const value = parseEnvOutputPath(output);
    if (value !== null) return value;
  }
  return '';
};

export const standardInstallDirectories = (
  platform: NodeJS.Platform,
  home: string = homedir(),
): string[] => {
  if (platform === 'win32') {
    const appData = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming');
    return [
      path.join(home, '.opencode', 'bin'),
      path.join(appData, 'npm'),
      path.join(home, '.bun', 'bin'),
      path.join(home, 'scoop', 'shims'),
    ];
  }
  return [
    path.join(home, '.opencode', 'bin'),
    path.join(home, '.bun', 'bin'),
    path.join(home, '.local', 'bin'),
    path.join(home, 'bin'),
    '/usr/local/bin',
    '/opt/homebrew/bin',
  ];
};

export const parseEnvOutputPath = (value: string): string | null => {
  const separator = value.includes('\0') ? '\0' : '\n';
  for (const entry of value.split(separator)) {
    if (entry.startsWith('PATH=')) return entry.slice('PATH='.length).trim();
  }
  return null;
};

const searchDirectories = async (
  directories: string[],
  options: ResolveExecutableOptions,
): Promise<string | null> => {
  const seen = new Set<string>();
  for (const directory of directories) {
    const trimmed = directory.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) continue;
    seen.add(trimmed);
    const resolved = await findInPathEntry(trimmed, options);
    if (resolved !== null) return resolved;
  }
  return null;
};

export const resolveExecutable = async (
  options: ResolveExecutableOptions,
): Promise<string | null> => {
  const configuredPath = options.configuredPath.trim();
  if (configuredPath.length > 0) {
    return resolveConfiguredPath(configuredPath, options);
  }

  return searchDirectories(
    [
      ...options.pathValue.split(options.pathDelimiter),
      ...options.loginShellPath.split(options.pathDelimiter),
      ...options.fallbackDirectories,
    ],
    options,
  );
};

export const resolveWindowsLaunchSpec = (
  binary: string,
  args: string[],
  options: WindowsLaunchSpecOptions,
): LaunchSpec => {
  const trimmed = binary.trim();
  if (options.platform !== 'win32') {
    return { binary: trimmed, args };
  }

  const extension = path.extname(trimmed).toLowerCase();
  const isBatchShim = extension === '.cmd' || extension === '.bat';
  const isBareName = extension.length === 0 && !trimmed.includes('\\') && !trimmed.includes('/');
  if (!isBatchShim && !isBareName) {
    return { binary: trimmed, args };
  }
  return {
    binary: options.comSpec ?? 'cmd.exe',
    args: ['/d', '/s', '/c', 'call', trimmed, ...args],
  };
};
