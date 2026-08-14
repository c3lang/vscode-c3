# vscode-c3

## Installation

```bash
git clone https://github.com/c3lang/vscode-c3.git
cd vscode-c3

npm install
npm run build
```

Building with bunx

```bash
bunx vsce package --no-dependencies
```

In vscode head over to the extensions section and click on the 3 dots. From there select "Install from VSIX ..." and select the newly created file

![](https://i.imgur.com/yv9C4AI.png)

## Language server & formatter binaries

On first activation the extension automatically downloads and manages the
[c3-lsp](https://github.com/tonis2/lsp) language server and the
[c3fmt](https://github.com/lmichaudel/c3fmt) formatter. A progress notification
is shown while each binary downloads — no prompt or manual step is required.

You can override this behaviour in your VS Code settings:

| Setting | Purpose |
| --- | --- |
| `c3.lsp.enable` | Set to `false` to disable the language server (skips the download). |
| `c3.lsp.path` | Point at a custom `c3-lsp` binary instead of the managed download. |
| `c3.format.enable` | Set to `false` to disable formatting (skips the download). |
| `c3.format.path` | Point at a custom `c3fmt` binary instead of the managed download. |
| `c3.tools.checkForUpdate` | Toggle the automatic update checks for both binaries. Replaces `c3.lsp.checkForUpdate` and `c3.format.checkForUpdate`, which are gone — clear them from your settings, they are ignored. |

When a `path` is left empty the extension keeps the binary up to date for you.

### Commands

Both are in the command palette, and the settings UI links to them as buttons from
the **Tools** section (`c3.tools.checkForUpdate`), which is its own settings group
precisely because each command covers both tools rather than one of them.

| Command | Purpose |
| --- | --- |
| `C3: Re-download tools (c3-lsp and c3fmt)` | Deletes the managed binaries and downloads the latest release of each, whatever version is installed. Use it when an install is damaged rather than outdated. |
| `C3: Check for tool updates` | Runs the update check on demand — for when the automatic notification was dismissed or missed. Reports the result even when everything is up to date. |

Both restart the language server and re-register the formatter afterwards, so no
window reload is needed. If a custom `path` is set, the command offers to clear it
first, since a custom binary otherwise shadows the managed download.

## Issues and contributing

If you find any issues or bugs feel free to open an issue or fix it yourself and open a Pull request.
