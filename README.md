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
| `c3.lsp.checkForUpdate` / `c3.format.checkForUpdate` | Toggle automatic update checks. |

When a `path` is left empty the extension keeps the binary up to date for you.

## Issues and contributing

If you find any issues or bugs feel free to open an issue or fix it yourself and open a Pull request.
