const path = require('path');
const { runTests } = require('@vscode/test-electron');

async function main() {
    try {
        const extensionDevelopmentPath = path.resolve(__dirname, '../../');
        const extensionTestsPath = path.resolve(__dirname, './suite/index');

        const testWorkspace = path.resolve(__dirname, './fixture');

        // Note: we can download VS Code, unzip it and run the integration test
        await runTests({
            extensionDevelopmentPath,
            extensionTestsPath,
            launchArgs: [testWorkspace, '--disable-extensions'] // Prevent interference from other extensions
        });
    } catch (err) {
        console.error('Failed to run tests');
        process.exit(1);
    }
}

main();
