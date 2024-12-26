import vscode from "vscode";
import { installLSP } from "./lsp";

export async function setupC3(context) {
    const lsConfig = vscode.workspace.getConfiguration("c3.lsp");

    if (!lsConfig.get("path")) {
        const response = await vscode.window.showInformationMessage(
            "You can enable C3LSP (the C3 Language Server) for a better editing experience. Would you like to install it?",
            { modal: true },
            "Download LSP binary",
            "Specify LSP binary path",
        );

        switch (response) {
            case "Download LSP binary":
                await installLSP(context)
                break;
            case "Specify LSP binary path":
                const uris = await vscode.window.showOpenDialog({
                    canSelectFiles: true,
                    canSelectFolders: false,
                    canSelectMany: false,
                    title: "Select C3 Language Server (C3LSP) executable",
                });
                if (!uris) return true;

                await lsConfig.update("path", uris[0].path, true);
                break;
            case undefined:
                break;
        }
    }

    return true;
}