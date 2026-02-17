import { activate as activateLS, deactivate as deactivateLS } from './lsp';
import { setupC3 } from './setupC3';
import { setupFormat } from './format';
import { setupDebug } from './debug';

export async function activate(context) {
    await setupC3(context);
    await setupFormat(context);
    setupDebug(context);
    activateLS(context);
}

export async function deactivate() {
    deactivateLS();
}