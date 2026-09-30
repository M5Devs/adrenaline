const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

console.log('Testing Adrenaline CLI...');

const projectRoot = path.resolve(__dirname, '..');
const cliBin = path.join(projectRoot, 'bin', 'cli.js');
const testAppName = 'test-scaffold-app';
const testAppDir = path.join(projectRoot, testAppName);

// Cleanup if leftover test dir exists
if (fs.existsSync(testAppDir)) {
    fs.rmSync(testAppDir, { recursive: true, force: true });
}

try {
    // 1. Test CLI --version and --help
    console.log('Testing CLI --version and --help...');
    const versionOutput = execSync(`node "${cliBin}" --version`, { encoding: 'utf8' }).trim();
    assert.ok(versionOutput.startsWith('v'), 'Version output should start with v');

    const helpOutput = execSync(`node "${cliBin}" --help`, { encoding: 'utf8' });
    assert.ok(helpOutput.includes('Adrenaline.js CLI'), 'Help output should include CLI name');
    assert.ok(helpOutput.includes('init'), 'Help output should include init command');

    // 2. Test scaffolding: node bin/cli.js init test-scaffold-app
    console.log(`Scaffolding test project: ${testAppName}...`);
    const initOutput = execSync(`node "${cliBin}" init ${testAppName}`, { cwd: projectRoot, encoding: 'utf8' });
    console.log('Init output:', initOutput);

    assert.ok(fs.existsSync(testAppDir), 'Project directory should exist');
    assert.ok(fs.existsSync(path.join(testAppDir, 'package.json')), 'package.json should exist in scaffolded app');
    assert.ok(fs.existsSync(path.join(testAppDir, 'main.js')), 'main.js should exist in scaffolded app');
    assert.ok(fs.existsSync(path.join(testAppDir, 'index.html')), 'index.html should exist in scaffolded app');

    const scaffoldedPkg = JSON.parse(fs.readFileSync(path.join(testAppDir, 'package.json'), 'utf8'));
    assert.strictEqual(scaffoldedPkg.name, testAppName, 'Scaffolded package.json name should match project name');

    // Create node_modules/adrenaline-js inside testAppDir to point to root index.js so require('adrenaline-js') works directly
    const nodeModulesDir = path.join(testAppDir, 'node_modules');
    const adrenalinePackageDir = path.join(nodeModulesDir, 'adrenaline-js');
    fs.mkdirSync(adrenalinePackageDir, { recursive: true });

    // Copy/link root index.js, package.json, lib and build into testAppDir node_modules/adrenaline-js
    fs.copyFileSync(path.join(projectRoot, 'index.js'), path.join(adrenalinePackageDir, 'index.js'));
    fs.copyFileSync(path.join(projectRoot, 'package.json'), path.join(adrenalinePackageDir, 'package.json'));

    function copyDirSync(src, dest) {
        fs.mkdirSync(dest, { recursive: true });
        for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
            const srcPath = path.join(src, entry.name);
            const destPath = path.join(dest, entry.name);
            if (entry.isDirectory()) {
                copyDirSync(srcPath, destPath);
            } else {
                fs.copyFileSync(srcPath, destPath);
            }
        }
    }

    copyDirSync(path.join(projectRoot, 'lib'), path.join(adrenalinePackageDir, 'lib'));
    copyDirSync(path.join(projectRoot, 'build'), path.join(adrenalinePackageDir, 'build'));

    // 3. Test running the scaffolded app cleanly
    console.log('Testing scaffolded app execution...');

    // Modify main.js of scaffolded app slightly to auto-exit after test run
    const scaffoldedMainPath = path.join(testAppDir, 'main.js');
    let mainCode = fs.readFileSync(scaffoldedMainPath, 'utf8');

    const testMainCode = `
${mainCode}

setTimeout(() => {
    console.log('Test app auto-exiting cleanly');
    process.exit(0);
}, 1500);
`;

    fs.writeFileSync(scaffoldedMainPath, testMainCode);

    // Execute `node bin/cli.js start` inside testAppDir
    console.log('Launching scaffolded app using CLI start command...');
    const startOutput = execSync(`node "${cliBin}" start`, {
        cwd: testAppDir,
        encoding: 'utf8',
        env: { ...process.env, DISPLAY: process.env.DISPLAY || ':99' }
    });
    console.log('App start output:', startOutput);
    assert.ok(startOutput.includes('Test app auto-exiting cleanly'), 'Scaffolded app executed and completed cleanly');

    console.log('All CLI tests passed successfully!');
} finally {
    // Cleanup
    if (fs.existsSync(testAppDir)) {
        fs.rmSync(testAppDir, { recursive: true, force: true });
    }
}
