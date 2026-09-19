export const LABELS = {
  viewTitle: 'OpenChamber',
  loading: 'Starting OpenChamber…',
  stopped: 'OpenChamber is stopped.',
  retry: 'Retry',
  vaultUnavailable:
    'Could not resolve the vault folder. OpenChamber starts with its default project directory.',
  vaultDataDirUnavailable:
    'Could not prepare this vault\'s OpenChamber settings. The panel may open on the default project directory.',
  commandOpen: 'Open OpenChamber',
  commandRestart: 'Restart OpenChamber server',
  commandStop: 'Stop OpenChamber server',
  ribbonOpen: 'Open OpenChamber',
  statusStopped: 'OpenChamber: stopped',
  statusStarting: 'OpenChamber: starting…',
  statusRunning: 'OpenChamber: running',
  statusRunningWithPort: (port: number): string => `OpenChamber: running (${port})`,
  statusError: 'OpenChamber: error',
  portReassigned: (preferred: number, actual: number): string =>
    `Port ${preferred} is in use; using port ${actual}.`,
  settingsOpenchamberPath: 'Executable path',
  settingsOpenchamberPathDesc:
    'Full path to the openchamber executable. Leave empty to detect it from PATH.',
  settingsPort: 'Port',
  settingsPortDesc: 'Port the local OpenChamber server listens on.',
  settingsAutoStart: 'Start server automatically',
  settingsAutoStartDesc: 'Start the local OpenChamber server when the plugin loads.',
  settingsExternalUrl: 'External URL',
  settingsExternalUrlDesc:
    'OpenChamber instance to open instead of starting a local server.',
} as const;
