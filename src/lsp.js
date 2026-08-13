import { platform, machine } from "os";
import childProcess from "child_process";
import { promisify } from "util";
import { getJson } from "./http";
import semver from "semver";
import vscode from "vscode";
import { downloadAndExtractArtifact, isManagedPath, binaryExists } from "./utils";
import { LanguageClient } from 'vscode-languageclient/node';
import { Trace } from 'vscode-jsonrpc';

const execFile = promisify(childProcess.execFile);

const GITHUB_API_URL = "https://api.github.com/repos/tonis2/lsp/releases/latest";

// Subdirectory of globalStorageUri holding the server this extension downloads.
const INSTALL_DIR = "c3lsp_install";

// globalState keys tracking the server this extension downloaded. The managed path
// deliberately does not live in `c3.lsp.path`: that setting is user-visible and
// outlives both the extension and globalStorage, so a stale managed value there used
// to shadow the real install with no way to recover. See migrateManagedPath.
const STATE_PATH = "c3lsp.installedPath";
const STATE_VERSION = "c3lsp.installedVersion";
const STATE_VERIFIED = "c3lsp.verifiedFor";

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

    const server = resolveServerPath(context);

    if (!server) {
        return;
    }

    const executablePath = server.path;

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
        checkUpdate(context).catch((err) => console.log("C3LSP update check failed:", err));
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
        const release = await getJson(GITHUB_API_URL, { Accept: "application/vnd.github+json" });
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
    const server = resolveServerPath(context);
    if (!server) return;

    const { version: currentVersion, error: versionError } = getVersion(server.path, "--version");
    // A binary we manage that cannot report a parseable version is either broken
    // or left over from a different server. Reinstall instead of giving up, which
    // would leave the user stuck on it forever.
    if (!currentVersion) {
        if (server.managed) {
            // Present but cannot run at all: a re-download would fail identically
            // (e.g. the binary needs a newer glibc than this system has), so
            // surface the real error instead of silently reinstalling.
            // Missing, or running but unparseable version: reinstall is right.
            if ((await binaryExists(server.path)) && versionError) {
                await reportUnrunnableServer(context, server, versionError);
            } else {
                await installLSP(context);
            }
        }
        return;
    }

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

// The server to run: an explicit `c3.lsp.path` wins, otherwise the install we
// manage. `managed` says whether we own the binary and may replace it silently.
export function resolveServerPath(context) {
    const configured = vscode.workspace.getConfiguration("c3.lsp").get("path");
    if (configured) return { path: configured, managed: false };

    const installed = context.globalState.get(STATE_PATH);
    if (installed) return { path: installed, managed: true };

    return null;
}

// Extension versions up to 0.3.6 recorded the downloaded server in `c3.lsp.path`.
// Clear such values so they stop shadowing the managed install, keeping the path as
// our own state when it still points somewhere useful. Without this, a leftover
// pre-0.3 pherrymason/c3-lsp path pins the user to a server that cannot start, and
// neither uninstalling the extension nor deleting globalStorage clears it.
export async function migrateManagedPath(context) {
    const configuration = vscode.workspace.getConfiguration("c3.lsp");
    const configured = configuration.get("path");
    if (!configured || !isManagedPath(context, configured)) return;

    // `c3.lsp.path` is machine-scoped, so Global is the only target it can be written to.
    await configuration.update("path", undefined, true);
    if (!context.globalState.get(STATE_PATH)) {
        await context.globalState.update(STATE_PATH, configured);
    }
}

// A compatibility probe is only meaningful for one (extension version, binary) pair:
// a newer extension may pass flags the installed server rejects, and a different path
// is a different binary. Deliberately not a substitute for the existence check —
// the stamp records that a probe once succeeded, not that the file is still there.
function verificationStamp(context, binPath) {
    return `${context.extension.packageJSON.version}|${binPath}`;
}

export function isVerified(context, binPath) {
    return context.globalState.get(STATE_VERIFIED) === verificationStamp(context, binPath);
}

export async function markVerified(context, binPath) {
    await context.globalState.update(STATE_VERIFIED, verificationStamp(context, binPath));
}

// True when `binPath` is a server this extension can actually drive.
//
// Releases before 0.3 installed pherrymason/c3-lsp; 0.3 switched the backend to
// tonis2/lsp and started passing --compiler-path. The old server is built on Go's
// flag package, which aborts on an unknown flag with exit code 2 before ever
// speaking LSP — the client then reports "couldn't create connection to server".
// Probing with the exact flag we are about to pass tests that incompatibility
// directly, rather than guessing from a version number or an install path.
export async function serverIsCompatible(binPath) {
    try {
        await execFile(binPath, ["--compiler-path=c3c", "--version"], { timeout: 5000 });
        return true;
    } catch {
        return false;
    }
}

// One-line human-readable reason for a failed probe, for the error popup: prefer
// the first non-empty stderr line (the dynamic linker's GLIBC_2.38 error, for
// example), then the exit code or signal.
export function serverFailureReason(probeError) {
    const firstLine = String(probeError?.stderr || probeError?.message || "")
        .split("\n")
        .find((l) => l.trim() !== "");
    if (firstLine) return firstLine.trim().slice(0, 300);
    const code = probeError?.code !== undefined ? probeError.code : probeError?.status;
    if (code !== undefined && code !== null) return `the process exited with code ${code}`;
    if (probeError?.signal) return `the process was killed (${probeError.signal})`;
    return "the server process could not be started";
}

export function getVersion(filePath, arg) {
    try {
        const buffer = childProcess.execFileSync(filePath, [arg], { timeout: 5000 });
        const versionString = buffer.toString("utf8").trim();

        return { version: semver.parse(versionString), error: null };
    } catch (err) {
        return { version: null, error: err };
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
        vscode.Uri.joinPath(context.globalStorageUri, INSTALL_DIR),
        url,
        [],
    );

    if (!lsPath) {
        vscode.window.showErrorMessage("Failed to install C3LSP");
        return null;
    }

    await context.globalState.update(STATE_PATH, lsPath);
    await context.globalState.update(STATE_VERSION, release.tag);
    // Drop any previous verification: a reinstall usually lands on the same path, and
    // stamping here would trust a download that has never been run. The next start
    // probes it once instead, so a corrupt or wrong-platform asset still self-heals.
    await context.globalState.update(STATE_VERIFIED, undefined);

    return lsPath;
}

// Module lifetime is one extension-host session; reloading the window reloads the
// module, so "once per activation" holds across all call sites.
let brokenServerReported = false;

// Red popup for a managed binary that exists but cannot start on this system
// (e.g. built for a newer glibc). setupC3 (which always runs first) and
// checkUpdate can both detect the same broken binary in one activation, so the
// guard keeps it to a single popup. Never silently re-downloads; a manual
// "Re-download" stays available for genuinely corrupt downloads.
export async function reportUnrunnableServer(context, server, probeError) {
    if (brokenServerReported) return;
    if (context.extensionMode === vscode.ExtensionMode.Test) return;
    brokenServerReported = true;

    const choice = await vscode.window.showErrorMessage(
        `The C3 language server at ${server.path} cannot run on this system: ` +
        `${serverFailureReason(probeError)}. The binary is installed but cannot start, ` +
        `so re-downloading may not fix it.`,
        "Re-download",
        "Ignore",
    );
    if (choice === "Re-download") {
        brokenServerReported = false; // a second failed download should report again
        try {
            await installLSP(context);
        } catch (err) {
            // The download itself failed (e.g. network error): installLSP's own
            // error popups cover the release/asset cases, but the fetch can also
            // throw, which would otherwise surface as an unhandled rejection.
            console.log("C3LSP re-download failed:", err);
        }
    }
}
