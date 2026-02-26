import { platform } from "os";
import childProcess from "child_process";
import axios from "axios";
import semver from "semver";
import vscode from "vscode";
import { downloadAndExtractArtifact } from "./utils";

const GITHUB_API_URL = "https://api.github.com/repos/lmichaudel/c3fmt/releases/latest";
const GITHUB_RELEASE_URL = "https://github.com/lmichaudel/c3fmt/releases/download";

const PLATFORM_ASSET = {
	linux: "c3fmt-linux.zip",
	darwin: "c3fmt-macos.zip",
	win32: "c3fmt-windows.zip",
};

async function fetchLatestRelease() {
	try {
		const response = await axios.get(GITHUB_API_URL);
		const release = response.data;
		return {
			version: semver.parse(release.tag_name),
			tag: release.tag_name,
		};
	} catch (err) {
		console.log("Error fetching c3fmt release:", err);
		return null;
	}
}

function getAssetUrl(tag) {
	const asset = PLATFORM_ASSET[platform()];
	if (!asset) return null;
	return `${GITHUB_RELEASE_URL}/${tag}/${asset}`;
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

	const url = getAssetUrl(release.tag);

	const fmtPath = await downloadAndExtractArtifact(
		"c3fmt",
		"c3fmt",
		vscode.Uri.joinPath(context.globalStorageUri, "c3fmt_install"),
		url,
		[],
	);

	const configuration = vscode.workspace.getConfiguration("c3.format");
	await configuration.update("path", fmtPath ?? undefined, true);
	await context.globalState.update("c3fmt.installedVersion", release.tag);
}

export async function checkC3FmtUpdate(context) {
	const release = await fetchLatestRelease();
	if (!release) return;

	const installedTag = context.globalState.get("c3fmt.installedVersion");
	if (installedTag === release.tag) return;

	const configuration = vscode.workspace.getConfiguration("c3.format");
	const fmtPath = configuration.get("path");
	const currentVersion = getVersion(fmtPath);
	if (currentVersion && semver.gte(currentVersion, release.version)) return;

	const response = await vscode.window.showInformationMessage(
		"New version of c3fmt available: " + release.version,
		"Install",
		"Ignore",
	);

	if (response === "Install") {
		await installC3Fmt(context, release);
	}
}

export async function setupC3Fmt(context) {
	const fmtConfig = vscode.workspace.getConfiguration("c3.format");

	if (!fmtConfig.get("enable")) return;

	if (!fmtConfig.get("path")) {
		const response = await vscode.window.showInformationMessage(
			"c3fmt (the C3 formatter) can be installed for code formatting support. Would you like to install it?",
			"Download c3fmt",
			"Specify c3fmt path",
			"Disable formatting",
		);

		switch (response) {
			case "Download c3fmt":
				await installC3Fmt(context);
				break;
			case "Specify c3fmt path":
				const uris = await vscode.window.showOpenDialog({
					canSelectFiles: true,
					canSelectFolders: false,
					canSelectMany: false,
					title: "Select c3fmt executable",
				});
				if (uris) {
					await fmtConfig.update("path", uris[0].path, true);
				}
				break;
			case "Disable formatting":
				await fmtConfig.update("enable", false, true);
				break;
			case undefined:
				break;
		}
	} else if (fmtConfig.get("checkForUpdate")) {
		await checkC3FmtUpdate(context);
	}
}
