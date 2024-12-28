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
			progress.report({ message: `downloading ${title} zip...` });
			const response = await axios.get(artifactUrl, {
				responseType: "arraybuffer",
				onDownloadProgress: (progressEvent) => {
					if (progressEvent.total) {
						const increment = (progressEvent.bytes / progressEvent.total) * 100;
						progress.report({
							message: progressEvent.progress ? `downloading zip ${(progressEvent.progress * 100).toFixed()}%` : "downloading zip...",
							increment: increment,
						});
					}
				},
			});

			const zipUri = vscode.Uri.joinPath(installDir, path.basename(artifactUrl));
			const isWindows = process.platform === "win32";
			// Delete old lsp folder
			await vscode.workspace.fs.delete(installDir, { recursive: true, useTrash: false }).catch((err) => {});
			await vscode.workspace.fs.createDirectory(installDir);
			await vscode.workspace.fs.writeFile(zipUri, response.data);

			progress.report({ message: "Extracting..." });
			const zip_path = isWindows ? zipUri.path.slice(1) : zipUri.path;
			const install_path = isWindows ? installDir.path.slice(1) : installDir.path;

			const files = await decompress(zip_path, install_path, {
				map: (file) => {
					file.path = file.path;
					return file;
				},
			});

			const exePath = vscode.Uri.joinPath(installDir, files[0].path).fsPath;
			await chmod(exePath, 0o755);

			return exePath;
		},
	);
}
