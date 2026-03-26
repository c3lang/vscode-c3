import vscode from "vscode";
import { installLSP } from "./lsp";

export async function setupC3(context) {
    const lsConfig = vscode.workspace.getConfiguration("c3.lsp");

    if (!lsConfig.get("path")) {
        if (context.extensionMode === vscode.ExtensionMode.Test) {
            return true;
        }
        const response = await vscode.window.showInformationMessage(
            "C3LSP (the C3 Language Server) can be installed for a better editing experience. Would you like to install it?",
            "Download C3LSP",
            "Specify C3LSP path",
            "Disable LSP",
        );

        switch (response) {
            case "Download C3LSP":
                await installLSP(context);
                break;
            case "Specify C3LSP path":
                const uris = await vscode.window.showOpenDialog({
                    canSelectFiles: true,
                    canSelectFolders: false,
                    canSelectMany: false,
                    title: "Select C3LSP executable",
                });
                if (uris) {
                    await lsConfig.update("path", uris[0].fsPath, true);
                }
                break;
            case "Disable LSP":
                await lsConfig.update("enable", false, true);
                break;
            case undefined:
                break;
        }
    }

    return true;
}
