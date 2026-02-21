import vscode from "vscode";
import { spawn } from "child_process";

function runC3Fmt(text, formatterPath) {
	return new Promise((resolve, reject) => {
		const folder = vscode.workspace.workspaceFolders?.[0];
		const proc = spawn(formatterPath, ["--stdin", "--stdout"], {
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

export async function setupFormat(context) {
	const fmtConfig = vscode.workspace.getConfiguration("c3.format");

	if (!fmtConfig.get("enable")) return;

	const fmtPath = fmtConfig.get("path");
	if (!fmtPath) return;

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
						const result = await runC3Fmt(input, fmtPath);

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
