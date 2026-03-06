const assert = require('assert');
const vscode = require('vscode');

suite('Extension Test Suite', () => {
    vscode.window.showInformationMessage('Start all tests.');

    test('Extension should be present', () => {
        assert.ok(vscode.extensions.getExtension('c3.vscode-c3'));
    });

    test('Extension should activate successfully', async () => {
        const ext = vscode.extensions.getExtension('c3.vscode-c3');
        if (!ext) {
            assert.fail('Extension not found');
        }
        await ext.activate();
        assert.ok(ext.isActive, 'Extension did not activate');
    });
});
