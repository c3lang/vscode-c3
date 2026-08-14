import { platform, machine } from "os";
import childProcess from "child_process";
import { promisify } from "util";
import { getJson } from "./http";
import semver from "semver";
import vscode from "vscode";
import { downloadAndExtractArtifact, isManagedPath, binaryExists, shouldCheckForUpdate } from "./utils";
import { LanguageClient } from 'vscode-languageclient/node';
import { Trace } from 'vscode-jsonrpc';

const execFile = promisify(childProcess.execFile);

const GITHUB_API_URL = "https://api.github.com/repos/tonis2/lsp/releases/latest";

// Subdirectory of globalStorageUri holding the server this extension downloads.
const INSTALL_DIR = "c3lsp_install";

// How long a server may take to answer a probe flag before we call it hung. Every
// probe runs during activation, so this is a ceiling on how long a broken binary can
// hold up the extension.
const PROBE_TIMEOUT_MS = 5000;

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

    if (shouldCheckForUpdate()) {
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

// Name used when reporting on this tool to the user.
const TOOL = "c3-lsp";

// Compares the installed server against the latest release and offers the update.
// The activation-time caller ignores the return value; the manual "check for
// updates" command uses it to report a result even when there is nothing to do,
// since a command that answers with silence looks broken. See describeCheck.
export async function checkUpdate(context) {
    const server = resolveServerPath(context);
    if (!server) return { tool: TOOL, state: "missing" };

    const { version: currentVersion, error: versionError } = await getVersion(server.path, "--version");
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
                if (await reportUnrunnableServer(context, server, versionError)) {
                    await restartServer(context);
                }
            } else {
                await installLSP(context);
            }
        }
        return { tool: TOOL, state: "unknown" };
    }

    const release = await fetchLatestRelease();
    if (!release || !release.version) return { tool: TOOL, state: "unknown", current: currentVersion };

    if (semver.gte(currentVersion, release.version)) {
        return { tool: TOOL, state: "current", current: currentVersion };
    }

    const response = await vscode.window.showInformationMessage("New version of C3LSP available: " + release.version, "Install", "Ignore");
    if (response === "Install") {
        const installed = await installLSP(context, release);
        return {
            tool: TOOL,
            state: installed ? "updated" : "unknown",
            current: currentVersion,
            latest: release.version,
        };
    }

    // "Ignore", or the notification was dismissed.
    return { tool: TOOL, state: "available", current: currentVersion, latest: release.version };
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

// Runs `binPath` with the exact flags we are about to pass the real server. The
// error is kept rather than swallowed: it is the only thing that tells a binary
// which never started from one which started and refused us.
//
// Releases before 0.3 installed pherrymason/c3-lsp; 0.3 switched the backend to
// tonis2/lsp and started passing --compiler-path. The old server is built on Go's
// flag package, which aborts on an unknown flag with exit code 2 before ever
// speaking LSP — the client then reports "couldn't create connection to server".
// Probing with the exact flag we are about to pass tests that incompatibility
// directly, rather than guessing from a version number or an install path.
export async function probeServer(binPath) {
    try {
        await execFile(binPath, ["--compiler-path=c3c", "--version"], { timeout: PROBE_TIMEOUT_MS });
        return { ok: true, error: null };
    } catch (error) {
        return { ok: false, error };
    }
}

// True when the probe never got the program running at all: the spawn itself failed,
// which child_process reports as an errno string in `code` (ENOENT, EACCES, ENOEXEC),
// or the process hung and we killed it. A program that ran and exited has a numeric
// `code` instead — which is exactly what a server rejecting one of our flags looks
// like, and is also how a binary that dies in the dynamic linker reports itself.
function neverRan(probeError) {
    return typeof probeError?.code === "string" || probeError?.killed === true;
}

// The reason `binPath` cannot start at all, or null when it does start and therefore
// merely disagrees with us about flags.
//
// A failed --compiler-path probe has two very different causes: the binary cannot run
// on this system (built against a newer glibc, wrong architecture, not executable),
// or it ran and rejected the flag, which is what the pre-0.3 server does. A bare
// --version probe separates them, since every server answers that: a second failure
// says nothing about our flags and everything about the binary. Spawn failures skip
// the second probe — nothing ran, so nothing can be learned by running it again.
export async function startupFailure(binPath, probeError) {
    if (neverRan(probeError)) return probeError;

    const { error } = await getVersion(binPath, "--version");
    return error || null;
}

// One-line human-readable reason for a failed probe, for the error popup: prefer
// the first non-empty stderr line (the dynamic linker's GLIBC_2.38 error, for
// example), then the errno, exit code or signal.
export function serverFailureReason(probeError) {
    const firstLine = String(probeError?.stderr ?? "")
        .split("\n")
        .find((l) => l.trim() !== "");
    if (firstLine) return firstLine.trim().slice(0, 300);

    // Checked before `code`, which a timeout leaves null.
    if (probeError?.killed) return `it did not answer within ${PROBE_TIMEOUT_MS / 1000} seconds`;

    switch (probeError?.code) {
        case "ENOENT": return "the file is no longer there";
        case "EACCES": return "the file is not executable";
        case "ENOEXEC": return "the file is not a program this system can run";
    }
    if (typeof probeError?.code === "number") return `the process exited with code ${probeError.code}`;
    if (probeError?.signal) return `the process was killed (${probeError.signal})`;
    return String(probeError?.message || "the server process could not be started");
}

// Async so a server that hangs on --version cannot block the extension host: this
// runs on every activation that has an update check enabled.
export async function getVersion(filePath, arg) {
    try {
        const { stdout } = await execFile(filePath, [arg], { timeout: PROBE_TIMEOUT_MS });

        return { version: semver.parse(stdout.trim()), error: null };
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

// Unconditional re-download for the manual command: no version comparison and no
// prompt, because this exists for an install that is damaged rather than outdated,
// where the version on disk is not what is wrong with it. The install directory is
// replaced wholesale by the download itself, so the old copy cannot survive.
//
// Returns whether the fresh server actually runs, which is the caller's cue to
// restart the language client.
export async function reinstallLSP(context) {
    const installedPath = await installLSP(context);
    if (!installedPath) return false;

    // Probe before handing it to the client for the same reason a fresh install
    // does: a download that does not fit this system should end in a plain
    // explanation rather than a stream of connection errors.
    const probe = await probeServer(installedPath);
    if (!probe.ok) {
        const failure = await startupFailure(installedPath, probe.error);
        if (failure) {
            vscode.window.showErrorMessage(
                `The re-downloaded C3 language server cannot run on this system: ` +
                `${serverFailureReason(failure)}.`,
            );
            return false;
        }
        // It runs but rejects our flags, which means the release itself is out of
        // step with this extension. Nothing the user can fix by downloading again.
        vscode.window.showErrorMessage(
            `The re-downloaded C3 language server did not accept this extension's ` +
            `arguments: ${serverFailureReason(probe.error)}.`,
        );
        return false;
    }

    await markVerified(context, installedPath);
    return true;
}

// Module lifetime is one extension-host session; reloading the window reloads the
// module, so "once per activation" holds across all call sites.
let brokenServerReported = false;

// Red popup for a managed binary that exists but cannot start on this system
// (e.g. built for a newer glibc). setupC3 (which always runs first) and
// checkUpdate can both detect the same broken binary in one activation, so the
// guard keeps it to a single popup. Never silently re-downloads; a manual
// "Re-download" stays available for the causes a fresh copy does fix, such as a
// download that was truncated or never made executable.
//
// Returns whether a re-download produced a server that actually runs, which is the
// caller's cue to start the language client: the user answers this popup long after
// activation has finished, so nothing else is left to do it.
export async function reportUnrunnableServer(context, server, probeError) {
    if (brokenServerReported) return false;
    if (context.extensionMode === vscode.ExtensionMode.Test) return false;
    brokenServerReported = true;

    // The popup carries one line; keep the whole error where a bug report can find it.
    console.log("C3LSP cannot start:", probeError);

    const choice = await vscode.window.showErrorMessage(
        `The C3 language server at ${server.path} cannot run on this system: ` +
        `${serverFailureReason(probeError)}. Re-downloading helps only if the copy on ` +
        `disk is damaged, not if the binary is incompatible with this system.`,
        "Re-download",
        "Ignore",
    );
    if (choice !== "Re-download") return false;

    brokenServerReported = false; // a second failed download should report again

    let installedPath;
    try {
        installedPath = await installLSP(context);
    } catch (err) {
        // The download itself failed (e.g. network error): installLSP's own
        // error popups cover the release/asset cases, but the fetch can also
        // throw, which would otherwise surface as an unhandled rejection.
        console.log("C3LSP re-download failed:", err);
        return false;
    }
    if (!installedPath) return false;

    // Probe the replacement before handing it to the client, so the case this popup
    // exists for — a fresh copy failing exactly like the old one — ends in a plain
    // explanation rather than the connection errors the user started with.
    const probe = await probeServer(installedPath);
    if (probe.ok) {
        await markVerified(context, installedPath);
        return true;
    }

    brokenServerReported = true;
    console.log("C3LSP still cannot start after re-download:", probe.error);
    vscode.window.showErrorMessage(
        `The re-downloaded C3 language server still cannot run on this system: ` +
        `${serverFailureReason(probe.error)}.`,
    );
    return false;
}

// Start the language client, replacing one that is already running. Repairs finish
// after activation has returned, so they start the server themselves.
export async function restartServer(context) {
    await deactivate();
    await activate(context);
}
