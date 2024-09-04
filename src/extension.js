import { Trace } from "vscode-jsonrpc";
import { LanguageClient } from "vscode-languageclient";
import { join } from "path";

import { activate as activateLS, deactivate as deactivateLS } from './lsp';
import { setupC3 } from './setupC3';

/*
let client = null;
const config = workspace.getConfiguration("c3.lsp");
module.exports = {
  activate: activate,
  deactivate: deactivate
}*/

export async function activate(context) {
    await setupC3(context).finally(() => {
       activateLS(context);
    });
}

export async function deactivate() {
    deactivateLS(context);
}
