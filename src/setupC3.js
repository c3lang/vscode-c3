import vscode from "vscode";
import { installLSP } from "./lsp";


export async function setupC3(context) {
    initialSetup(context)
}



async function initialSetup(context) {
    const lsConfig = vscode.workspace.getConfiguration("c3.lsp");

    if (!lsConfig.get("path")) {
        const response = await vscode.window.showInformationMessage(
            "You can enable C3LSP (the C3 Language Server) for a better editing experience. Would you like to install it?",
            { modal: true },
            "Install",
            "Specify path",
            "Use C3LSP in PATH",
        );

        switch (response) {
            case "Install":
                // TODO installC3LSP(context,false);
                installLSP(context)
                break;
            case "Specify path":
                const uris = await vscode.window.showOpenDialog({
                    canSelectFiles: true,
                    canSelectFolders: false,
                    canSelectMany: false,
                    title: "Select C3 Language Server (C3LSP) executable",
                });
                if (!uris) return true;

                await lsConfig.update("path", uris[0].path, true);
                break;
            
            case "Use C3LSP in PATH":
                await lsConfig.update("path", "c3lsp", true);
                break;
            case undefined:
                break;
        }
    }

    return true;
}