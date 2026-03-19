import axios from "axios";
import decompress from "decompress";
import path from "path";
import fs from "fs";
import { promisify } from "util";
import vscode from "vscode";

const chmod = promisify(fs.chmod);

export async function downloadAndExtractArtifact(
	/** e.g. `C3CLSP` */
	title,
	/** e.g. `c3lsp` */
	executableName,
	/** e.g. inside `context.globalStorageUri` */
	installDir,
	artifactUrl,
	/** The expected sha256 hash (in hex) of the artifact/tarball. */
	//sha256,
	/** Extract arguments that should be passed to `tar`. e.g. `--strip-components=1` */
	extraTarArgs,
) {
	return await vscode.window.withProgress(
		{
			title: `Installing ${title}`,
			location: vscode.ProgressLocation.Notification,
		},
		async (progress) => {
			progress.report({ message: `downloading ${title}...` });
			const response = await axios.get(artifactUrl, {
				responseType: "arraybuffer",
				onDownloadProgress: (progressEvent) => {
					if (progressEvent.total) {
						const increment = (progressEvent.bytes / progressEvent.total) * 100;
						progress.report({
							message: progressEvent.progress ? `downloading ${(progressEvent.progress * 100).toFixed()}%` : "downloading...",
							increment: increment,
						});
					}
				},
			});

			const zipUri = vscode.Uri.joinPath(installDir, path.basename(artifactUrl));
			// Delete old lsp folder
			await vscode.workspace.fs.delete(installDir, { recursive: true, useTrash: false }).catch((err) => {});
			await vscode.workspace.fs.createDirectory(installDir);
			await vscode.workspace.fs.writeFile(zipUri, response.data);

			const zip_path = zipUri.fsPath;
			const install_path = installDir.fsPath;

			const data = Buffer.from(response.data);
			// Detect archive by magic bytes: ZIP (PK\x03\x04) or gzip (\x1f\x8b)
			const isZip =
				artifactUrl.endsWith(".zip") || artifactUrl.endsWith(".tar.gz") ||
				(data.length >= 4 && data[0] === 0x50 && data[1] === 0x4B && data[2] === 0x03 && data[3] === 0x04) ||
				(data.length >= 2 && data[0] === 0x1F && data[1] === 0x8B);
			if (isZip) {
				progress.report({ message: "Extracting..." });
				// Filter out documentation/license files that contain underscores (e.g., LICENSE_MIT)
				const files = (await decompress(zip_path, install_path))
					.filter((file) => !file.path.includes("_"));

				const exePath = vscode.Uri.joinPath(installDir, files[0].path).fsPath;
				await chmod(exePath, 0o755);
				return exePath;
			} else {
				// Raw binary, no extraction needed
				await chmod(zip_path, 0o755);
				return zip_path;
			}
		},
	);
}
