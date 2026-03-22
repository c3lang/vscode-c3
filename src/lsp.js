import { platform, machine } from "os";
import childProcess from "child_process";
import axios from "axios";
import semver from "semver";
import vscode from "vscode";
import { downloadAndExtractArtifact } from "./utils";
import { LanguageClient } from 'vscode-languageclient/node';
import { Trace } from 'vscode-jsonrpc';

const GITHUB_API_URL = "https://api.github.com/repos/tonis2/lsp/releases/latest";

const PLATFORM_MAP = {
	linux: "linux",
	darwin: "macos",
	win32: "windows",
};

const ARCH_MAP = {
	x64: "x86_64",
	x86_64: "x86_64",
	arm64: "aarch64",
	aarch64: "aarch64",
};

let client = null;
export async function activate(context) {
    const config = vscode.workspace.getConfiguration("c3");
    const lsConfig = vscode.workspace.getConfiguration("c3.lsp");
    const enabled = lsConfig.get("enable");

    if (!enabled) {
        return;
    }

    let executablePath = lsConfig.get("path");

    if (!executablePath) {
        return;
    }

    let args = [];
    if (lsConfig.get("sendCrashReports")) {
        args.push("--send-crash-reports");
    }

    if (lsConfig.get("log.path") != "") {
        args.push(`--log-path=${lsConfig.get("log.path")}`);
    }

    if (lsConfig.get('diagnosticsDelay')) {
		args.push(`--diagnostics-delay=${Number(lsConfig.get('diagnosticsDelay'))}`);
	}

    if (config.get('stdlib-path')) {
		args.push(`--stdlib-path=${config.get('stdlib-path')}`);
	}

    let compilerPath = lsConfig.get('compilerPath') || 'c3c';
    if (compilerPath === 'c3c') {
        // Resolve absolute path since VSCode may not inherit the user's full PATH
        try {
            let resolved;
            if (platform() === 'win32') {
                resolved = childProcess.execSync('where c3c', {
                    encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'ignore'],
                }).trim().split('\n')[0];
            } else {
                // Try common login shells to pick up .bashrc/.zshrc/.profile PATH entries
                const shells = [process.env.SHELL, '/bin/bash', '/bin/zsh', '/bin/sh'].filter(Boolean);
                for (const shell of shells) {
                    try {
                        resolved = childProcess.execSync(`${shell} -lc "command -v c3c"`, {
                            encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'ignore'],
                        }).trim();
                        if (resolved) break;
                    } catch { /* try next shell */ }
                }
            }
            if (resolved) compilerPath = resolved;
        } catch {
            // c3c not found, keep default and let LSP report the error
        }
    }
    args.push(`--compiler-path=${compilerPath}`);

    const serverOptions = {
        run: {
            command: executablePath,
            args: args,
        },
        debug: {
            command: executablePath,
            args: args,
            options: { execArgv: ["--nolazy", "--inspect=6009"] },
        },
    };

	// Options to control the language client
	const clientOptions = {
		// Register the server for plain text documents
		documentSelector: [{ scheme: "file", language: "c3" }],
		synchronize: {
			// Notify the server about file changes to '.c3' or '.c3i' files contained in the workspace
			fileEvents: vscode.workspace.createFileSystemWatcher("**/*.{c3,c3i}"),
		}
	};

    if (lsConfig.get("checkForUpdate")) {
        await checkUpdate(context);
    }

    client = new LanguageClient("C3LSP", serverOptions, clientOptions);
    if (lsConfig.get("debug")) {
        client.setTrace(Trace.Verbose);
    }
    client.start();
}


export async function deactivate() {
    if (client) {
        await client.stop();
        await client.dispose();
    }
    client = null;
}

async function fetchLatestRelease() {
    try {
        const response = await axios.get(GITHUB_API_URL);
        const release = response.data;
        return {
            version: semver.parse(release.tag_name),
            tag: release.tag_name,
            assets: release.assets || [],
        };
    } catch (err) {
        console.log("Error fetching C3LSP release:", err);
        return null;
    }
}

function getAssetUrl(release) {
    const plat = PLATFORM_MAP[platform()];
    const arch = ARCH_MAP[machine()];
    if (!plat || !arch) return null;

    const prefix = `c3-lsp-${plat}-${arch}`;
    const asset = release.assets.find((a) => a.name.startsWith(prefix));
    if (asset) {
        return asset.browser_download_url;
    }

    return null;
}

async function checkUpdate(context) {
    const configuration = vscode.workspace.getConfiguration("c3.lsp");
    const c3lspPath = configuration.get("path");

    const currentVersion = getVersion(c3lspPath, "--version");
    if (!currentVersion) return;

    const release = await fetchLatestRelease();
    if (!release || !release.version) return;

    if (semver.gte(currentVersion, release.version)) return;

    const response = await vscode.window.showInformationMessage("New version of C3LSP available: " + release.version, "Install", "Ignore");
    switch (response) {
        case "Install":
            await installLSP(context, release);
            break;
        case "Ignore":
        case undefined:
            break;
    }
}

export function getVersion(filePath, arg) {
    try {
        const buffer = childProcess.execFileSync(filePath, [arg]);
        const versionString = buffer.toString("utf8").trim();

        return semver.parse(versionString);
    } catch {
        return null;
    }
}

export async function installLSP(context, release) {
    if (!release) {
        release = await fetchLatestRelease();
        if (!release) {
            vscode.window.showErrorMessage("Failed to fetch C3LSP release information");
            return;
        }
    }

    const url = getAssetUrl(release);
    if (!url) {
        vscode.window.showErrorMessage(`No C3LSP binary available for your platform: ${platform()} ${machine()}`);
        return;
    }

    const lsPath = await downloadAndExtractArtifact(
        "C3LSP",
        "c3lsp",
        vscode.Uri.joinPath(context.globalStorageUri, "c3lsp_install"),
        url,
        [],
    );

    const configuration = vscode.workspace.getConfiguration("c3.lsp", null);
    await configuration.update("path", lsPath ?? undefined, true);
    await context.globalState.update("c3lsp.installedVersion", release.tag);
}
