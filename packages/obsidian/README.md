# OpenChamber for Obsidian

Run OpenChamber agent sessions against your vault from an Obsidian side panel. The plugin starts `openchamber serve` and embeds the UI in an iframe, with the vault root as the project directory.

## Requirements

- Obsidian 1.13.0 or newer on desktop. Mobile is not supported.
- The `openchamber` CLI in PATH, or a full path to it in the plugin settings.

## Install

Put `main.js`, `manifest.json`, and `styles.css` in `.obsidian/plugins/openchamber-ui` inside your vault, then enable **OpenChamber** under Settings, Community plugins.

## Usage

The panel opens from the ribbon icon or the **Open OpenChamber** command. With auto-start on, the server starts when the plugin loads, on port 3000.

Commands:

- **Open OpenChamber** opens the panel and starts the server if it is stopped.
- **Restart OpenChamber server** stops the current process and starts a new one. Use it after changing the port.
- **Stop OpenChamber server** stops the process the plugin started.

The status bar shows the server state: stopped, starting, running, or error. On a server failure, the panel shows the message and a retry button, and a notice shows the same message. When the server is stopped, for example after the stop command or with auto-start off, the panel shows a stopped message and the same retry button.

The plugin stops the server it started when you disable the plugin or quit Obsidian. It never stops a server it did not start.

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Executable path | _(empty)_ | Full path to the `openchamber` CLI. Leave empty to auto-detect it. |
| Port | `3000` | Preferred port for the local server. |
| Start server automatically | on | Start the local server when the plugin loads. |
| External URL | _(empty)_ | An OpenChamber instance to open instead of starting a local server. Shown only when auto-start is off. |

Auto-detect searches the process PATH, then the login shell's PATH, then common install locations. Obsidian launched from Finder or the Dock has only the system default PATH, so the login shell is what makes detection work. If it still fails, set the full path in Executable path.

The port is a preference. If it is already in use, the plugin starts the server on an available port and a notice reports the reassignment.

To point the panel at a remote OpenChamber instance, turn off auto-start and set the external URL. The plugin spawns nothing in that mode.

## Where the panel keeps its settings

Each vault gets its own OpenChamber instance, so the panel opens on the vault instead of your home directory and does not touch the settings of your other OpenChamber windows. That instance stores its settings in `~/.config/openchamber/obsidian-vaults/<vault>/settings.json`, where `<vault>` is a hash of the vault path.

The first time you open a vault, the plugin creates that file with the vault as the active project. After that the plugin leaves it alone, so a theme, model, or directory you pick inside the panel stays chosen. Provider logins are shared with your normal OpenChamber install, because OpenCode keeps its auth outside this directory.

The vault instance starts with empty `themes/`, `projects/`, and `speech-models/` folders, so OpenChamber does not copy your real folders into every vault. Custom themes from your normal install do not appear in the panel; set them once inside the panel.
