import { platform } from "os";
import childProcess from "child_process";
import { getJson } from "./http";
import semver from "semver";
import vscode from "vscode";
import { downloadAndExtractArtifact, isManagedPath, binaryExists, shouldCheckForUpdate } from "./utils";

const GITHUB_API_URL = "https://api.github.com/repos/lmichaudel/c3fmt/releases/latest";
const GITHUB_RELEASE_URL = "https://github.com/lmichaudel/c3fmt/releases/download";

// Subdirectory of globalStorageUri holding the formatter this extension downloads.
const INSTALL_DIR = "c3fmt_install";

// globalState keys tracking the formatter this extension downloaded. As with the
// language server, the managed path is deliberately kept out of `c3.format.path`:
// that setting is user-visible and outlives both the extension and globalStorage, so
// a stale managed value there shadows the real install. See migrateManagedFmtPath.
const STATE_PATH = "c3fmt.installedPath";
const STATE_VERSION = "c3fmt.installedVersion";

const STDIN_FILEPATH_FLAG = "--stdin-filepath";

// Name used when reporting on this tool to the user.
const TOOL = "c3fmt";

const PLATFORM_ASSET = {
	linux: "c3fmt-linux",
	darwin: "c3fmt-macos",
	win32: "c3fmt-windows.exe",
};

async function fetchLatestRelease() {
	try {
		const release = await getJson(GITHUB_API_URL, { Accept: "application/vnd.github+json" });
		return {
			version: semver.parse(release.tag_name),
			tag: release.tag_name,
			assets: release.assets || [],
		};
	} catch (err) {
		console.log("Error fetching c3fmt release:", err);
		return null;
	}
}

function getAssetUrl(release) {
	const assetPrefix = PLATFORM_ASSET[platform()];
	if (!assetPrefix) return null;

	// Find the actual asset from the release (may be raw binary or zipped)
	const asset = release.assets.find((a) => a.name.startsWith(assetPrefix));
	if (asset) {
		return asset.browser_download_url;
	}

	// Fallback to constructed URL if assets aren't available
	return `${GITHUB_RELEASE_URL}/${release.tag}/${assetPrefix}`;
}

function getVersion(filePath) {
	try {
		const output = childProcess.execFileSync(filePath, ["--version"]).toString("utf8");
		const match = output.match(/(\d+\.\d+\.\d+)/);
		return match ? semver.parse(match[1]) : null;
	} catch {
		return null;
	}
}

// The formatter to run: an explicit `c3.format.path` wins, otherwise the install we
// manage. `managed` says whether we own the binary and may replace it silently.
export function resolveFormatterPath(context) {
	const configured = vscode.workspace.getConfiguration("c3.format").get("path");
	if (configured) return { path: configured, managed: false };

	const installed = context.globalState.get(STATE_PATH);
	if (installed) return { path: installed, managed: true };

	return null;
}

// Extension versions up to 0.3.6 recorded the downloaded formatter in `c3.format.path`.
// Clear such values so they stop shadowing the managed install, keeping the path as our
// own state when it still points somewhere useful. Without this, a formatter deleted
// from globalStorage is never reinstalled, because a non-empty setting used to be taken
// as proof that a working binary existed.
export async function migrateManagedFmtPath(context) {
	const configuration = vscode.workspace.getConfiguration("c3.format");
	const configured = configuration.get("path");
	if (!configured || !isManagedPath(context, configured)) return;

	await configuration.update("path", undefined, true);
	if (!context.globalState.get(STATE_PATH)) {
		await context.globalState.update(STATE_PATH, configured);
	}
}

// Whether `binPath` accepts --stdin-filepath, read from the binary's own help output
// rather than compared against a version floor: the flag appeared partway through the
// 0.2.x series, and across every release checked, help listing it matched actual support
// exactly. c3fmt rejects unrecognised options with a usage dump and a non-zero exit, so
// guessing wrong would turn every format request into an error. Unknown means no.
export function supportsStdinFilepath(binPath) {
	// --help itself exits non-zero, so the usage text normally arrives via the error.
	const read = (result) => `${result?.stdout ?? result ?? ""}${result?.stderr ?? ""}`;
	try {
		const output = childProcess.execFileSync(binPath, ["--help"], {
			timeout: 5000,
			stdio: ["ignore", "pipe", "pipe"],
		});
		return read(output).includes(STDIN_FILEPATH_FLAG);
	} catch (err) {
		return read(err).includes(STDIN_FILEPATH_FLAG);
	}
}

export async function installC3Fmt(context, release) {
	const asset = PLATFORM_ASSET[platform()];
	if (!asset) {
		vscode.window.showErrorMessage(`No c3fmt binary available for your platform: ${platform()}`);
		return;
	}

	if (!release) {
		release = await fetchLatestRelease();
		if (!release) {
			vscode.window.showErrorMessage("Failed to fetch c3fmt release information");
			return;
		}
	}

	const url = getAssetUrl(release);

	const fmtPath = await downloadAndExtractArtifact(
		"c3fmt",
		"c3fmt",
		vscode.Uri.joinPath(context.globalStorageUri, INSTALL_DIR),
		url,
		[],
	);

	if (!fmtPath) {
		vscode.window.showErrorMessage("Failed to install c3fmt");
		return null;
	}

	await context.globalState.update(STATE_PATH, fmtPath);
	await context.globalState.update(STATE_VERSION, release.tag);

	return fmtPath;
}

// Unconditional re-download for the manual command: no version comparison and no
// prompt, since this is for a copy that is damaged rather than outdated. The
// download replaces the whole install directory, so nothing of the old one is left.
export async function reinstallC3Fmt(context) {
	return Boolean(await installC3Fmt(context));
}

// Compares the installed formatter against the latest release and offers the update.
// As with the language server, the return value exists for the manual "check for
// updates" command; the activation-time caller ignores it.
export async function checkC3FmtUpdate(context) {
	const release = await fetchLatestRelease();
	if (!release || !release.version) return { tool: TOOL, state: "unknown" };

	// Checked before reading the binary's own version, which costs a process spawn
	// on every activation that has update checks enabled.
	const installedTag = context.globalState.get(STATE_VERSION);
	if (installedTag === release.tag) return { tool: TOOL, state: "current", current: release.version };

	const formatter = resolveFormatterPath(context);
	const currentVersion = formatter ? getVersion(formatter.path) : null;
	if (currentVersion && semver.gte(currentVersion, release.version)) {
		return { tool: TOOL, state: "current", current: currentVersion };
	}

	const response = await vscode.window.showInformationMessage(
		"New version of c3fmt available: " + release.version,
		"Install",
		"Ignore",
	);

	if (response === "Install") {
		const installed = await installC3Fmt(context, release);
		return {
			tool: TOOL,
			state: installed ? "updated" : "unknown",
			current: currentVersion,
			latest: release.version,
		};
	}

	return { tool: TOOL, state: "available", current: currentVersion, latest: release.version };
}

export async function setupC3Fmt(context) {
	const fmtConfig = vscode.workspace.getConfiguration("c3.format");

	if (!fmtConfig.get("enable")) return;
	if (context.extensionMode === vscode.ExtensionMode.Test) return;

	await migrateManagedFmtPath(context);

	const formatter = resolveFormatterPath(context);

	// A non-empty setting used to be taken as proof that a formatter existed, so an
	// install deleted from globalStorage stayed broken. Check the file, not the setting.
	if (!formatter || !(await binaryExists(formatter.path))) {
		if (formatter && !formatter.managed) {
			vscode.window.showErrorMessage(
				`c3fmt was not found at ${formatter.path}. Clear the c3.format.path setting ` +
				`to use the formatter this extension manages.`,
			);
			return;
		}
		await installC3Fmt(context);
		return;
	}

	if (shouldCheckForUpdate()) {
		checkC3FmtUpdate(context).catch((err) => console.log("c3fmt update check failed:", err));
	}
}
