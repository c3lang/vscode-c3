import vscode from "vscode";
import { spawn } from "child_process";

function runClangFormat(text, fileName, formatterPath = "clang-format") {
    return new Promise((resolve, reject) => {
        const args = [];

        if (fileName) {
            args.push("-assume-filename", fileName);
        }

        const proc = spawn(formatterPath, args);

        let stdout = "";
        let stderr = "";

        proc.stdout.on("data", (data) => (stdout += data));
        proc.stderr.on("data", (data) => (stderr += data));

        proc.on("error", reject);

        proc.on("close", (code) => {
            if (code !== 0) {
                return reject(new Error(`clang-format exited with code ${code}: ${stderr}`));
            }

            resolve(stdout);
        });

        proc.stdin.end(text);
    });
}

export async function setupFormat(context) {
    const fmtConfig = vscode.workspace.getConfiguration("c3.format");
    const fmtPath = fmtConfig.get("path") || "clang-format";

    context.subscriptions.push(
        // Format full document
        vscode.languages.registerDocumentFormattingEditProvider(
            [
                { language: "c3", scheme: "file" },     // files on disk
                { language: "c3", scheme: "untitled" }, // unsaved files
            ], {
                async provideDocumentFormattingEdits(document) {
                    try {
                        const input = document.getText();
                        const result = await runClangFormat(input, document.fileName, fmtPath);

                        const fullRange = new vscode.Range(
                            document.positionAt(0),
                            document.positionAt(input.length)
                        );

                        return [
                            vscode.TextEdit.replace(fullRange, result)
                        ];
                    } catch (err) {
                        vscode.window.showErrorMessage(
                            `Error formatting c3 document: ${err.message}`
                        );
                        return [];
                    }
                }
        })
    );
}
