import { activate as activateLS, deactivate as deactivateLS } from './lsp';
import { setupC3 } from './setupC3';
import { setupC3Fmt } from './c3fmt';
import { setupFormat } from './format';
import { setupDebug } from './debug';
import { registerCommands } from './commands';

export async function activate(context) {
    // Registered first so the manual repair commands exist even while setup is
    // still running, or when it gave up on a tool it could not install.
    registerCommands(context);

    // setupC3 returns false when there is no server worth connecting to: the binary
    // exists but cannot run on this system (e.g. built for a newer glibc), or a
    // repair is still waiting on the user. Starting the client anyway would spawn a
    // process that dies immediately, producing connection errors and unhandled
    // rejections. A repair the user accepts starts the server itself.
    const lspReady = await setupC3(context);
    await setupC3Fmt(context);
    await setupFormat(context);
    await setupDebug(context);
    if (lspReady) {
        await activateLS(context);
    }
}

export async function deactivate() {
    deactivateLS();
}