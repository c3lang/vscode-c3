import vscode from "vscode";
import {
    installLSP,
    resolveServerPath,
    migrateManagedPath,
    probeServer,
    isVerified,
    markVerified,
    startupFailure,
    serverFailureReason,
    reportUnrunnableServer,
    restartServer,
} from "./lsp";
import { binaryExists } from "./utils";

export async function setupC3(context) {
    const lsConfig = vscode.workspace.getConfiguration("c3.lsp");

    if (!lsConfig.get("enable")) return true;
    if (context.extensionMode === vscode.ExtensionMode.Test) return true;

    await migrateManagedPath(context);

    let server = resolveServerPath(context);

    // A fresh install falls through to the checks below rather than being handed
    // straight to the client: this is the one path that would otherwise start a
    // binary nobody has ever run, which is exactly where an asset that does not fit
    // this system shows up.
    if (!server) {
        const installedPath = await installLSP(context);
        if (!installedPath) return false;
        server = { path: installedPath, managed: true };
    }

    // Checked before the verification stamp: the stamp says a probe once succeeded,
    // which tells us nothing about a binary the user has since deleted.
    if (!(await binaryExists(server.path))) {
        return await repair(context, server, `The C3 language server is missing from ${server.path}.`);
    }

    // This exact binary already answered our flags under this extension version, so
    // skip the probe rather than spawning a process on every activation.
    if (isVerified(context, server.path)) return true;

    const probe = await probeServer(server.path);
    if (probe.ok) {
        await markVerified(context, server.path);
        return true;
    }

    // The binary exists but cannot start on this system at all (e.g. built against
    // a newer glibc than this system provides): it cannot even answer --version, so
    // it will never serve a connection. Re-downloading reproduces that failure
    // exactly, so the real error is surfaced instead of a silent reinstall.
    const failure = await startupFailure(server.path, probe.error);
    if (failure) {
        // A binary we manage gets its own popup: a re-download is worth offering, but
        // only alongside the reason it may not help. A path the user set is theirs,
        // so there the offer is to switch to the managed server instead.
        const answered = server.managed
            ? reportUnrunnableServer(context, server, failure)
            : askToInstallManaged(
                context,
                server,
                `The C3 language server at ${server.path} cannot run on this system: ` +
                `${serverFailureReason(failure)}.`,
            );

        repairInBackground(context, answered);
        // The user's answer lands long after this returns, so the client cannot be
        // started here — and must not be: spawning the broken binary would only
        // produce a stream of connection errors and unhandled rejections.
        return false;
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
// so ask before overriding their setting. Returns whether the install now holds a
// server worth starting: a declined or failed repair leaves nothing to connect to.
async function repair(context, server, reason) {
    // Ours to replace, so there is nothing to ask and the caller can wait for the
    // replacement.
    if (server.managed) return Boolean(await installLSP(context));

    repairInBackground(context, askToInstallManaged(context, server, reason));
    return false;
}

async function askToInstallManaged(context, server, reason) {
    const choice = await vscode.window.showErrorMessage(
        `${reason} Install the server this extension manages instead? ` +
        `This clears the c3.lsp.path setting.`,
        "Install managed server",
        "Ignore",
    );

    if (choice !== "Install managed server") return false;

    // Leaving the setting in place would shadow the fresh install and bring this
    // same prompt back on every activation.
    await vscode.workspace.getConfiguration("c3.lsp").update("path", undefined, true);
    return Boolean(await installLSP(context));
}

// Repairs that need an answer from the user run detached: a notification stays up
// until it is answered, and neither extension activation nor the setup that follows
// it (formatter, debugger) may hang on that. The language client is started here
// rather than by the caller, which has long since returned by then.
function repairInBackground(context, repaired) {
    repaired
        .then((ready) => (ready ? restartServer(context) : undefined))
        .catch((err) => console.log("C3LSP repair failed:", err));
}
