import vscode from "vscode";
import { spawn } from "child_process";
import path from "path";
import { resolveFormatterPath, supportsStdinFilepath } from "./c3fmt";

function runC3Fmt(text, formatterPath, filepathHint) {
	return new Promise((resolve, reject) => {
		const folder = vscode.workspace.workspaceFolders?.[0];
		const args = ["--stdin", "--stdout"];
		if (filepathHint) {
			args.push(`--stdin-filepath=${filepathHint}`);
		}

		const proc = spawn(formatterPath, args, {
			cwd: folder?.uri.fsPath,
		});

		let stdout = "";
		let stderr = "";

		proc.stdout.on("data", (data) => (stdout += data));
		proc.stderr.on("data", (data) => (stderr += data));

		proc.on("error", reject);

		proc.on("close", (code) => {
			if (code !== 0) {
				return reject(new Error(`c3fmt exited with code ${code}: ${stderr}`));
			}
			resolve(stdout);
		});

		proc.stdin.end(text);
	});
}

// c3fmt looks for a .c3fmt config by walking up from this path, so pointing it at the
// document picks up the config nearest the file rather than whichever one happens to sit
// beside the first workspace folder. Only the parent directory of the hint is searched,
// so untitled buffers — which have no path on disk — need a placeholder filename joined
// onto their workspace folder; a bare directory would resolve one level too high.
function stdinFilepath(document) {
	if (document.uri.scheme === "file") {
		return document.uri.fsPath;
	}

	const folder = vscode.workspace.getWorkspaceFolder(document.uri)
		?? vscode.workspace.workspaceFolders?.[0];

	return folder ? path.join(folder.uri.fsPath, "untitled.c3") : null;
}

export async function setupFormat(context) {
	const fmtConfig = vscode.workspace.getConfiguration("c3.format");

	if (!fmtConfig.get("enable")) return;

	const formatter = resolveFormatterPath(context);
	if (!formatter) return;

	// Resolved on first use and kept for the session: probing --help costs a process
	// spawn, which is not worth repeating for every format request.
	let canHintFilepath = null;

	context.subscriptions.push(
		vscode.languages.registerDocumentFormattingEditProvider(
			[
				{ language: "c3", scheme: "file" },
				{ language: "c3", scheme: "untitled" },
			],
			{
				async provideDocumentFormattingEdits(document) {
					try {
						const input = document.getText();

						if (canHintFilepath === null) {
							canHintFilepath = supportsStdinFilepath(formatter.path);
						}

						const result = await runC3Fmt(
							input,
							formatter.path,
							canHintFilepath ? stdinFilepath(document) : null,
						);

						const fullRange = new vscode.Range(
							document.positionAt(0),
							document.positionAt(input.length),
						);

						return [vscode.TextEdit.replace(fullRange, result)];
					} catch (err) {
						if (err.message?.includes("SOURCE_CODE_CONTAINS_ERROR")) {
							vscode.window.showWarningMessage(
								"c3fmt: Cannot format file with syntax errors",
							);
						} else {
							vscode.window.showErrorMessage(
								`Error formatting C3 document: ${err.message}`,
							);
						}
						return [];
					}
				},
			},
		),
	);
}
