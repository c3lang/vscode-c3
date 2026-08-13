import { activate as activateLS, deactivate as deactivateLS } from './lsp';
import { setupC3 } from './setupC3';
import { setupC3Fmt } from './c3fmt';
import { setupFormat } from './format';
import { setupDebug } from './debug';

export async function activate(context) {
    // setupC3 returns false when the server binary exists but cannot run on this
    // system (e.g. built for a newer glibc): starting the client anyway would
    // spawn a process that dies immediately, producing connection errors and
    // unhandled rejections. The formatter and debugger are independent of the
    // language server, so they still get set up.
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