import vscode from "vscode";
import { reinstallLSP, checkUpdate, restartServer } from "./lsp";
import { reinstallC3Fmt, checkC3FmtUpdate } from "./c3fmt";
import { setupFormat } from "./format";

// Manual entry points for the two managed binaries. Everything here is also done
// automatically on activation; these exist for the cases automation cannot reach:
// an update notification that was dismissed or missed (there is no way to bring it
// back short of restarting VSCode), and an install that is present but damaged,
// which no version comparison will ever decide to replace.
//
// Both are reachable from the command palette and from the command links in the
// `c3.lsp.path` / `c3.format.path` setting descriptions, which the settings UI
// renders as clickable links.

// Downloads run inside a progress notification and take a while, so a second
// invocation while one is in flight would put two downloads on the same install
// directory. The guard covers both commands: a check can end in an install too.
let inFlight = false;

export function registerCommands(context) {
    context.subscriptions.push(
        vscode.commands.registerCommand("c3.reinstallTools", () => runExclusive(() => reinstallTools(context))),
        vscode.commands.registerCommand("c3.checkForUpdates", () => runExclusive(() => checkForUpdates(context))),
    );
}

async function runExclusive(action) {
    if (inFlight) {
        vscode.window.showInformationMessage("A C3 tool download is already in progress.");
        return;
    }

    inFlight = true;
    try {
        await action();
    } catch (err) {
        // Downloads throw on network errors, and a command's rejection would
        // otherwise surface as a bare "running the contributed command failed".
        console.log("C3 tool command failed:", err);
        vscode.window.showErrorMessage(`C3: ${err?.message || err}`);
    } finally {
        inFlight = false;
    }
}

// Deletes and re-downloads both managed binaries, whatever versions are installed.
async function reinstallTools(context) {
    const results = [];

    if (isEnabled("c3.lsp")) {
        if (await useManagedBinary("c3.lsp", "c3-lsp", "c3.lsp.path")) {
            const installed = await reinstallLSP(context);
            results.push(describeInstall("c3-lsp", installed));
            // The running client still holds the binary that was just replaced, so
            // restart it rather than making the user reload the window. Skipped when
            // the fresh copy does not run: reinstallLSP has already said why.
            if (installed) await restartServer(context);
        } else {
            results.push("c3-lsp left on its custom path");
        }
    }

    if (isEnabled("c3.format")) {
        if (await useManagedBinary("c3.format", "c3fmt", "c3.format.path")) {
            const installed = await reinstallC3Fmt(context);
            results.push(describeInstall("c3fmt", installed));
            // Re-registers the formatting provider, which had captured the old path
            // — and which is not registered at all when the download that just
            // succeeded is the first one to do so.
            if (installed) await setupFormat(context);
        } else {
            results.push("c3fmt left on its custom path");
        }
    }

    report(results, "Nothing to re-download: both C3 tools are disabled.");
}

// Checks both tools for updates and offers to install what is available. Unlike the
// automatic check this always reports, including when everything is up to date.
async function checkForUpdates(context) {
    const results = [];

    if (isEnabled("c3.lsp")) {
        const result = await checkUpdate(context);
        results.push(describeCheck(result));
        // An update installed from the prompt lands beside a client still running
        // the old server; the automatic check runs before the client starts, so
        // only this path has anything to restart.
        if (result?.state === "updated") await restartServer(context);
    }

    if (isEnabled("c3.format")) {
        const result = await checkC3FmtUpdate(context);
        results.push(describeCheck(result));
        if (result?.state === "updated") await setupFormat(context);
    }

    report(results, "Nothing to check: both C3 tools are disabled.");
}

function isEnabled(section) {
    return Boolean(vscode.workspace.getConfiguration(section).get("enable"));
}

// A path the user set wins over the managed install everywhere else in the
// extension, so re-downloading the managed copy while one is set would change
// nothing the user can observe. Offer to clear it rather than silently doing
// either the useless thing or the surprising one.
async function useManagedBinary(section, tool, settingId) {
    const configuration = vscode.workspace.getConfiguration(section);
    if (!configuration.get("path")) return true;

    const choice = await vscode.window.showWarningMessage(
        `${tool} is pinned to a custom binary by the ${settingId} setting. ` +
        `Clear it and download the version this extension manages?`,
        "Clear and download",
        "Keep custom path",
    );
    if (choice !== "Clear and download") return false;

    // Machine-scoped, so Global is the only target it can be written to.
    await configuration.update("path", undefined, true);
    return true;
}

function describeInstall(tool, installed) {
    return installed ? `${tool} re-downloaded` : `${tool} could not be re-downloaded`;
}

function describeCheck(result) {
    switch (result?.state) {
        case "current": return `${result.tool} is up to date (${result.current})`;
        case "updated": return `${result.tool} updated to ${result.latest}`;
        case "available": return `${result.tool} ${result.latest} is available`;
        case "missing": return `${result.tool} is not installed`;
        // "unknown": the release could not be fetched or the binary could not be
        // asked its version. Both paths report the specifics themselves.
        default: return `${result?.tool ?? "tool"}: could not be checked`;
    }
}

// One notification for both tools: two popups for one command reads as a bug, and
// the individual failures have already had their own error messages.
function report(results, emptyMessage) {
    if (results.length === 0) {
        vscode.window.showInformationMessage(emptyMessage);
        return;
    }

    vscode.window.showInformationMessage(`C3: ${results.join(" · ")}.`);
}
