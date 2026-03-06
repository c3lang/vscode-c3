import { activate as activateLS, deactivate as deactivateLS } from './lsp';
import { setupC3 } from './setupC3';
import { setupC3Fmt } from './c3fmt';
import { setupFormat } from './format';
import { setupDebug } from './debug';

export async function activate(context) {
    await setupC3(context);
    await setupC3Fmt(context);
    await setupFormat(context);
    await setupDebug(context);
    await activateLS(context);
}

export async function deactivate() {
    deactivateLS();
}