import { activate as activateLS, deactivate as deactivateLS } from './lsp';
import { setupC3 } from './setupC3';
import { setupC3Fmt } from './c3fmt';
import { setupFormat } from './format';

export async function activate(context) {
    await setupC3(context);
    await setupC3Fmt(context);
    await setupFormat(context);
    activateLS(context);
}

export async function deactivate() {
    deactivateLS();
}