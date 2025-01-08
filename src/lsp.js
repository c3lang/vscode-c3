import { platform, machine } from "os";
import childProcess from "child_process";
import axios from "axios";
import semver from "semver";
import vscode from "vscode";
import { downloadAndExtractArtifact } from "./utils";
import { LanguageClient } from 'vscode-languageclient/node';
import { Trace } from 'vscode-jsonrpc';

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
    if (config.get('stdlib-path')) {
		args.push(`--stdlib-path=${config.get('stdlib-path')}`);
	}
    
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

async function fetchVersion() {
    let response;
    try {
        response = (await axios.get(
            'https://pherrymason.github.io/c3-lsp/releases.json'
        )).data;
    } catch (err) {
        console.log("Error: ", err)
    }

    // Get latest version
    let version_data = response["releases"].sort((current, next) => current.version > next.version)[0];

    return {
        version: new semver.SemVer(version_data.version),
        artifacts: version_data.artifacts
    };
}

async function checkUpdate(context) {
    const configuration = vscode.workspace.getConfiguration("c3.lsp");
    const c3lspPath = configuration.get("path");

    const currentVersion = getVersion(c3lspPath, "--version");
    if (!currentVersion) return;

    const result = await fetchVersion();
    if (!result) return;

    if (semver.gte(currentVersion, result.version)) return;

    const response = await vscode.window.showInformationMessage("New version of C3LSP available: " + result.version, "Install", "Ignore");
    switch (response) {
        case "Install":
            await installLSPVersion(context, result.artifacts);
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

export async function installLSPVersion(context, artifact) {
    const key = machine() + '-' + platform();
    // example x86_64-win32
    if (!artifact[key]) {
        vscode.window.showErrorMessage(`No pre-build version available for your architecture/OS ${key}`);
        return
    }
    
    const lsPath = await downloadAndExtractArtifact(
        "C3LSP",
        "c3lsp",
        vscode.Uri.joinPath(context.globalStorageUri, "c3lsp_install"),
        artifact[key].url,
        [],
    );

    const configuration = vscode.workspace.getConfiguration("c3.lsp", null);
    await configuration.update("path", lsPath ?? undefined, true);
}


export async function installLSP(context) {
    const result = await fetchVersion();
    if (!result) return;
    await installLSPVersion(context, result.artifacts);
}