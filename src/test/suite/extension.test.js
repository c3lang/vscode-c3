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

    // The settings UI links to these by id, so a rename that misses one side of
    // the contract turns the links into silent no-ops.
    test('Tool commands should be registered', async () => {
        const ext = vscode.extensions.getExtension('c3.vscode-c3');
        await ext.activate();

        const commands = await vscode.commands.getCommands(true);
        for (const command of ['c3.reinstallTools', 'c3.checkForUpdates']) {
            assert.ok(commands.includes(command), `${command} is not registered`);
        }
    });

    test('Setting links should point at contributed commands', () => {
        const ext = vscode.extensions.getExtension('c3.vscode-c3');
        const contributed = new Set(ext.packageJSON.contributes.commands.map((c) => c.command));
        const properties = ext.packageJSON.contributes.configuration
            .flatMap((section) => Object.values(section.properties));

        for (const property of properties) {
            for (const [, id] of (property.markdownDescription ?? '').matchAll(/\(command:([^)]+)\)/g)) {
                assert.ok(contributed.has(id), `${id} is linked to but not contributed`);
            }
        }
    });

    // The buttons hang off this setting's description, and it is alone in its own
    // configuration group so that nothing can sort above it: that is what keeps
    // them out of the c3-lsp and c3fmt sections, which they do not belong to.
    test('Tools section should host the update setting and nothing else', () => {
        const ext = vscode.extensions.getExtension('c3.vscode-c3');
        const groups = ext.packageJSON.contributes.configuration;

        const tools = groups.find((group) => group.properties['c3.tools.checkForUpdate']);
        assert.ok(tools, 'c3.tools.checkForUpdate is not contributed');
        assert.deepEqual(Object.keys(tools.properties), ['c3.tools.checkForUpdate']);
        assert.ok(tools !== groups[0], 'the setting shares a group with the rest');

        // Every group needs an order once one has it, or the ordered ones sort first
        // and the rest land in an arbitrary place.
        for (const group of groups) {
            assert.equal(typeof group.order, 'number', `group ${group.title} has no order`);
        }
    });
});
