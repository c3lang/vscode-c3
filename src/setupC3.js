import vscode from "vscode";
import {
    installLSP,
    resolveServerPath,
    migrateManagedPath,
    serverIsCompatible,
    isVerified,
    markVerified,
} from "./lsp";
import { binaryExists } from "./utils";

export async function setupC3(context) {
    const lsConfig = vscode.workspace.getConfiguration("c3.lsp");

    if (!lsConfig.get("enable")) return true;
    if (context.extensionMode === vscode.ExtensionMode.Test) return true;

    await migrateManagedPath(context);

    const server = resolveServerPath(context);

    if (!server) {
        await installLSP(context);
        return true;
    }

    // Checked before the verification stamp: the stamp says a probe once succeeded,
    // which tells us nothing about a binary the user has since deleted.
    if (!(await binaryExists(server.path))) {
        return await repair(context, server, `The C3 language server is missing from ${server.path}.`);
    }

    // This exact binary already answered our flags under this extension version, so
    // skip the probe rather than spawning a process on every activation.
    if (isVerified(context, server.path)) return true;

    if (await serverIsCompatible(server.path)) {
        await markVerified(context, server.path);
        return true;
    }

    // The binary rejects --compiler-path, so it is the pre-0.3 server
    // (pherrymason/c3-lsp) that exits before a connection is established, or another
    // program entirely. Such an install never repaired itself: setupC3 used to skip
    // installing whenever a path was set, and checkUpdate short-circuits because the
    // old server's version numbers are higher than the current server's.
    return await repair(
        context,
        server,
        `The C3 language server at ${server.path} could not be started, or predates ` +
        `this extension's switch to the current server.`,
    );
}

// Replace the server when it is ours to replace; otherwise the user chose this path,
// so ask before overriding their setting.
async function repair(context, server, reason) {
    if (server.managed) {
        await installLSP(context);
        return true;
    }

    const choice = await vscode.window.showErrorMessage(
        `${reason} Install the server this extension manages instead? ` +
        `This clears the c3.lsp.path setting.`,
        "Install managed server",
        "Ignore",
    );

    if (choice === "Install managed server") {
        // Leaving the setting in place would shadow the fresh install and bring this
        // same prompt back on every activation.
        await vscode.workspace.getConfiguration("c3.lsp").update("path", undefined, true);
        await installLSP(context);
    }

    return true;
}
