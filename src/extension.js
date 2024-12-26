import { activate as activateLS, deactivate as deactivateLS } from './lsp';
import { setupC3 } from './setupC3';

export async function activate(context) {
    await setupC3(context);
    activateLS(context);
}

export async function deactivate() {
    deactivateLS(context);
}
