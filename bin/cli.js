#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const pkg = require('../package.json');

const args = process.argv.slice(2);
const command = args[0];

function showHelp() {
    console.log(`
Adrenaline.js CLI v${pkg.version}

Usage:
  adrenaline <command> [options]

Commands:
  init, create <project-name>  Scaffold a new Adrenaline.js desktop application
  start, dev                  Run the current Adrenaline.js application

Options:
  -v, --version                Show version number
  -h, --help                   Show help information
`);
}

function showVersion() {
    console.log(`v${pkg.version}`);
}

function copyRecursiveSync(src, dest) {
    const exists = fs.existsSync(src);
    const stats = exists && fs.statSync(src);
    const isDirectory = exists && stats.isDirectory();
    if (isDirectory) {
        if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
        }
        fs.readdirSync(src).forEach((childItemName) => {
            copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName));
        });
    } else {
        fs.copyFileSync(src, dest);
    }
}

function initProject(projectName) {
    if (!projectName) {
        console.error('Error: Please specify a project directory name.');
        console.error('Example: adrenaline init my-app');
        process.exit(1);
    }

    const targetDir = path.resolve(process.cwd(), projectName);

    if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length > 0) {
        console.error(`Error: Directory '${projectName}' already exists and is not empty.`);
        process.exit(1);
    }

    const templateDir = path.resolve(__dirname, '../templates/starter');
    if (!fs.existsSync(templateDir)) {
        console.error('Error: Starter template directory not found.');
        process.exit(1);
    }

    console.log(`\n⚡ Scaffolding new Adrenaline.js project in ${targetDir}...`);
    copyRecursiveSync(templateDir, targetDir);

    // Customize package.json with project name
    const targetPkgPath = path.join(targetDir, 'package.json');
    if (fs.existsSync(targetPkgPath)) {
        try {
            const projectPkg = JSON.parse(fs.readFileSync(targetPkgPath, 'utf8'));
            projectPkg.name = projectName.toLowerCase().replace(/[^a-z0-9-_]/g, '-');
            fs.writeFileSync(targetPkgPath, JSON.stringify(projectPkg, null, 2) + '\n');
        } catch (e) {
            // Ignore if package.json parsing fails
        }
    }

    console.log(`\n✨ Successfully created project '${projectName}'!`);
    console.log('\nGet started with:');
    console.log(`  cd ${projectName}`);
    console.log('  npm install');
    console.log('  npm start\n');
}

function runProject() {
    const cwd = process.cwd();
    const pkgPath = path.join(cwd, 'package.json');
    let mainFile = 'main.js';

    if (fs.existsSync(pkgPath)) {
        try {
            const currentPkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            if (currentPkg.main) {
                mainFile = currentPkg.main;
            }
        } catch (e) {
            // fallback to main.js
        }
    }

    const entryPath = path.resolve(cwd, mainFile);
    if (!fs.existsSync(entryPath)) {
        console.error(`Error: Entry file '${mainFile}' not found in current directory (${cwd}).`);
        process.exit(1);
    }

    console.log(`⚡ Launching Adrenaline app (${mainFile})...`);
    const child = spawn(process.execPath, [entryPath], {
        cwd,
        stdio: 'inherit',
        env: process.env
    });

    child.on('exit', (code, signal) => {
        if (code !== null && code !== undefined) {
            process.exit(code);
        } else {
            process.exit(0);
        }
    });
}

if (!command || command === '-h' || command === '--help' || command === 'help') {
    showHelp();
    process.exit(0);
} else if (command === '-v' || command === '--version' || command === 'version') {
    showVersion();
    process.exit(0);
} else if (command === 'init' || command === 'create') {
    const projectName = args[1];
    initProject(projectName);
} else if (command === 'start' || command === 'dev') {
    runProject();
} else {
    console.error(`Unknown command: ${command}`);
    showHelp();
    process.exit(1);
}
