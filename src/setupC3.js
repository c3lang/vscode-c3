import vscode from "vscode";
import { installLSP } from "./lsp";

export async function setupC3(context) {
    const lsConfig = vscode.workspace.getConfiguration("c3.lsp");

    if (!lsConfig.get("enable")) return true;

    if (!lsConfig.get("path")) {
        if (context.extensionMode === vscode.ExtensionMode.Test) {
            return true;
        }
        await installLSP(context);
    }

    return true;
}
