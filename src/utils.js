import axios from "axios";
import decompress from "decompress";
import path from "path";
import fs from "fs";
import { promisify } from "util";
import vscode from "vscode";
import {platform} from "os";

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
    extraTarArgs ,
) {
    //assert.strictEqual(sha256.length, 64);

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
                            message: progressEvent.progress
                                ? `downloading zip ${(progressEvent.progress * 100).toFixed()}%`
                                : "downloading zip...",
                            increment: increment,
                        });
                    }
                },
            });
            /*
            const tarHash = crypto.createHash("sha256").update(response.data).digest("hex");
            if (tarHash !== sha256) {
                throw Error(`hash of downloaded tarball ${tarHash} does not match expected hash ${sha256}`);
            }*/

            
            /*
            const tarPath = await which("tar", { nothrow: true });
            if (!tarPath) {
                void vscode.window.showErrorMessage(
                    `Downloaded ${title} tarball can't be extracted because 'tar' could not be found`,
                );
                return null;
            }*/

            const zipUri = vscode.Uri.joinPath(installDir, path.basename(artifactUrl));

            try {
                await vscode.workspace.fs.delete(installDir, { recursive: true, useTrash: false });
            } catch {}
            await vscode.workspace.fs.createDirectory(installDir);
            await vscode.workspace.fs.writeFile(zipUri, response.data);            
            
            progress.report({ message: "Extracting..." });
            try {
                //fs.createReadStream(zipUri).pipe(unzip.Extract({path: installDir}));
                const files = await decompress(zipUri.path, installDir.path);
                
            } catch (err) {
                if (err instanceof Error) {
                    void vscode.window.showErrorMessage(`Failed to extract ${title} zip: ${err.message}`);
                } else {
                    throw err;
                }
                return null;
            }
            
            /*
            progress.report({ message: "Extracting..." });
            try {
                await execFile(tarPath, ["-xf", tarballUri.fsPath, "-C", installDir.fsPath].concat(extraTarArgs), {
                    timeout: 60000, // 60 seconds
                });
            } catch (err) {
                if (err instanceof Error) {
                    void vscode.window.showErrorMessage(`Failed to extract ${title} tarball: ${err.message}`);
                } else {
                    throw err;
                }
                return null;
            } finally {
                try {
                    await vscode.workspace.fs.delete(tarballUri, { useTrash: false });
                } catch {}
            }
            */
            progress.report({ message: "Installing..." });

            const isWindows = process.platform === "win32";
            const exeName = `${executableName}${isWindows ? ".exe" : ""}`;
            const exePath = vscode.Uri.joinPath(installDir, exeName).fsPath;


            const exeNameDeprecated = `${"c3-lsp"}${isWindows ? ".exe" : ""}`;
            const exePathDeprecated = vscode.Uri.joinPath(installDir, exeNameDeprecated).fsPath;

            fs.rename(exePathDeprecated, exePath, (err) => {
                if (err) {
                    console.error('Error renombrando el archivo:', err);
                    void import_vscode.default.window.showErrorMessage(`Error renombrando el archivo: ${err}`);
                }
            });



            await chmod(exePath, 0o755);

            return exePath;
        },
    );
}
