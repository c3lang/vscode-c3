const path = require('path');
const Mocha = require('mocha');
const fs = require('fs');

function run() {
    const mocha = new Mocha({
        ui: 'tdd',
        color: true,
        timeout: 20000
    });

    const testsRoot = path.resolve(__dirname, '.');

    return new Promise((c, e) => {
        fs.readdir(testsRoot, (err, files) => {
            if (err) {
                return e(err);
            }

            // Add all test files
            files.filter(f => f.endsWith('.test.js')).forEach(f => {
                mocha.addFile(path.resolve(testsRoot, f));
            });

            try {
                // Run the mocha test
                mocha.run(failures => {
                    if (failures > 0) {
                        e(new Error(`${failures} tests failed.`));
                    } else {
                        c();
                    }
                });
            } catch (err) {
                console.error(err);
                e(err);
            }
        });
    });
}

module.exports = {
    run
};
