import { LanguageClient } from "vscode-languageclient";
import { platform, machine } from "os";
import childProcess from "child_process";
import axios from "axios";
import semver from "semver";
import vscode from "vscode";
import { downloadAndExtractArtifact } from "./utils";

let client = null;
export async function activate(context) {
    const config = vscode.workspace.getConfiguration("c3");
    const lsConfig = vscode.workspace.getConfiguration("c3.lsp");
    const enabled = lsConfig.get("enable");
    if (!enabled) {
        return;
    }

    let executablePath = lsConfig.get("path");

    if (executablePath == "") {
        return;
    }

    let args = [];
    if (lsConfig.get("sendCrashReports")) {
        args.push("--send-crash-reports");
    }
    if (lsConfig.get("log.path") != "") {
        args.push("--log-path=" + lsConfig.get("log.path"));
    }
    if (config.get("version") != "") {
        args.push("--lang-version=" + config.get("version"));
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

    const clientOptions = {
        documentSelector: [{ scheme: "file", language: "c3" }],
        synchronize: {
            fileEvents: vscode.workspace.createFileSystemWatcher("**/*.c3"),
        },
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
    try {
        response = (await axios.get(
            'https://pherrymason.github.io/c3-lsp/releases.json'
        )).data;
    } catch (err) {
        console.log("Error: ", err)
    }

    lastVersion = response.releases.length - 1

    return {
        version: new semver.SemVer(response.releases[lastVersion].version),
        artifacts: response.releases[lastVersion].artifacts
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