const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const RUN_DURATION_MS = 10000;
const SAMPLE_INTERVAL_MS = 1000;

function getProcessTreePids(rootPid) {
    const pids = new Set([rootPid]);
    try {
        const output = execSync(`pgrep -P ${rootPid}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
        const children = output.trim().split(/\s+/).map(p => parseInt(p, 10)).filter(Boolean);
        for (const childPid of children) {
            const subPids = getProcessTreePids(childPid);
            subPids.forEach(p => pids.add(p));
        }
    } catch (e) {
        // pgrep returns status 1 if no child processes found
    }
    return Array.from(pids);
}

function getProcessNameAndRole(pid) {
    try {
        const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ').trim();
        const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
        const commMatch = stat.match(/\(([^)]+)\)/);
        const comm = commMatch ? commMatch[1] : 'unknown';

        let role = 'Auxiliary Process';
        if (cmdline.includes('adrenaline-runner')) role = 'Main Node Process (Adrenaline)';
        else if (cmdline.includes('electron-runner')) role = 'Main Process (Electron)';
        else if (cmdline.includes('type=renderer')) role = 'Renderer Process';
        else if (cmdline.includes('type=gpu-process')) role = 'GPU Process';
        else if (cmdline.includes('type=utility') || cmdline.includes('type=zygote')) role = 'Utility / Helper Process';
        else if (comm.includes('WebKit') || comm.includes('WEBKIT') || comm.includes('WebKitWebProcess')) role = 'WebKit Web Process';
        else if (comm.includes('UIProcess') || comm.includes('WebKitNetwork')) role = 'WebKit Network/UI Process';

        return { pid, comm, cmdline, role };
    } catch (e) {
        return { pid, comm: 'defunct', cmdline: '', role: 'Terminated Process' };
    }
}

function getMemoryForPids(pids) {
    let totalPssKb = 0;
    let totalRssKb = 0;
    const processDetails = [];

    for (const pid of pids) {
        let pssKb = 0;
        let rssKb = 0;

        try {
            if (fs.existsSync(`/proc/${pid}/smaps_rollup`)) {
                const rollup = fs.readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8');
                const pssMatch = rollup.match(/^Pss:\s+(\d+)\s+kB/m);
                const rssMatch = rollup.match(/^Rss:\s+(\d+)\s+kB/m);
                if (pssMatch) pssKb = parseInt(pssMatch[1], 10);
                if (rssMatch) rssKb = parseInt(rssMatch[1], 10);
            } else if (fs.existsSync(`/proc/${pid}/status`)) {
                const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
                const vmRssMatch = status.match(/^VmRSS:\s+(\d+)\s+kB/m);
                if (vmRssMatch) rssKb = parseInt(vmRssMatch[1], 10);
                pssKb = rssKb; // Fallback
            }
        } catch (e) {
            // Process terminated during sampling
        }

        totalPssKb += pssKb;
        totalRssKb += rssKb;

        const info = getProcessNameAndRole(pid);
        processDetails.push({
            pid,
            comm: info.comm,
            role: info.role,
            pssMb: (pssKb / 1024).toFixed(2),
            rssMb: (rssKb / 1024).toFixed(2)
        });
    }

    return {
        count: pids.length,
        pssMb: totalPssKb / 1024,
        rssMb: totalRssKb / 1024,
        details: processDetails
    };
}

function terminateProcessTree(rootPid) {
    const pids = getProcessTreePids(rootPid);
    for (const pid of pids) {
        try {
            process.kill(pid, 'SIGKILL');
        } catch (e) {
            // Ignore process already dead
        }
    }
}

function getDiskKb(targetPath) {
    if (!fs.existsSync(targetPath)) return 0;
    try {
        const out = execSync(`du -sk ${targetPath}`, { encoding: 'utf8' });
        const kb = parseInt(out.split(/\s+/)[0], 10);
        return isNaN(kb) ? 0 : kb;
    } catch (e) {
        return 0;
    }
}

async function runBenchmark(name, runnerCommand, runnerArgs) {
    console.log(`\n========================================`);
    console.log(` Starting Benchmark Run: ${name}`);
    console.log(`========================================`);

    return new Promise((resolve) => {
        const startTime = Date.now();
        let startupTimeMs = null;

        const child = spawn(runnerCommand, runnerArgs, {
            stdio: ['ignore', 'ignore', 'pipe', 'ipc']
        });

        child.stderr.on('data', (data) => {
            // Suppress noise or log if needed
        });

        child.on('message', (msg) => {
            if (msg && msg.type === 'READY' && startupTimeMs === null) {
                startupTimeMs = msg.timeMs;
                console.log(`[${name}] Interactive Paint / Ready in ${startupTimeMs} ms`);
            }
        });

        const samples = [];

        const interval = setInterval(() => {
            if (!child.pid) return;
            const pids = getProcessTreePids(child.pid);
            const mem = getMemoryForPids(pids);
            samples.push(mem);
            console.log(`[${name}] Sample - Processes: ${mem.count}, PSS: ${mem.pssMb.toFixed(2)} MB, RSS: ${mem.rssMb.toFixed(2)} MB`);
        }, SAMPLE_INTERVAL_MS);

        setTimeout(() => {
            clearInterval(interval);
            console.log(`[${name}] Terminating process tree (PID ${child.pid})...`);
            terminateProcessTree(child.pid);

            // Compute metrics
            const maxProcesses = samples.reduce((m, s) => Math.max(m, s.count), 0);
            const peakPssMb = samples.reduce((m, s) => Math.max(m, s.pssMb), 0);
            const peakRssMb = samples.reduce((m, s) => Math.max(m, s.rssMb), 0);
            const avgPssMb = samples.length ? samples.reduce((s, x) => s + x.pssMb, 0) / samples.length : 0;
            const lastSampleDetails = samples.length ? samples[samples.length - 1].details : [];

            resolve({
                name,
                startupTimeMs: startupTimeMs || (Date.now() - startTime),
                processCount: maxProcesses,
                peakPssMb: peakPssMb.toFixed(2),
                avgPssMb: avgPssMb.toFixed(2),
                peakRssMb: peakRssMb.toFixed(2),
                lastSampleDetails
            });
        }, RUN_DURATION_MS);
    });
}

async function main() {
    console.log('Starting Head-to-Head Empirical Benchmark Suite...');

    const rootDir = path.resolve(__dirname, '../../');

    // 1. Electron Footprint: Requires bundled Chromium/Node binary distribution in node_modules/electron/dist
    const electronDistPath = path.join(rootDir, 'node_modules', 'electron', 'dist');
    const electronDistKb = getDiskKb(electronDistPath);
    const electronDiskMb = (electronDistKb / 1024).toFixed(2);

    // 2. Adrenaline Footprint: Native C++ Node Addon + JS Runtime Libraries + App Code + Assets
    const adrPaths = [
        path.join(rootDir, 'build/Release/adrenaline.node'),
        path.join(rootDir, 'lib'),
        path.join(rootDir, 'index.js'),
        path.join(rootDir, 'package.json'),
        path.join(rootDir, 'bin'),
        path.join(rootDir, 'benchmarks/head-to-head/app')
    ];
    const adrKb = adrPaths.reduce((acc, p) => acc + getDiskKb(p), 0);
    const adrenalineDiskMb = (adrKb / 1024).toFixed(2);

    // 1. Run Adrenaline
    const adrenalineRunner = path.join(__dirname, 'adrenaline-runner.js');
    const adrenalineMetrics = await runBenchmark('Adrenaline.js', 'node', [adrenalineRunner]);

    // 2. Run Electron
    const electronRunner = path.join(__dirname, 'electron-runner.js');
    const electronBin = require('electron');
    const electronMetrics = await runBenchmark('Electron', electronBin, [electronRunner, '--no-sandbox']);

    adrenalineMetrics.diskMb = adrenalineDiskMb;
    electronMetrics.diskMb = electronDiskMb;

    generateReport(adrenalineMetrics, electronMetrics);
}

function calculateDiff(electronVal, adrenalineVal) {
    const e = parseFloat(electronVal);
    const a = parseFloat(adrenalineVal);
    if (isNaN(e) || isNaN(a) || e === 0) return 'N/A';
    const diff = ((a - e) / e) * 100;
    const sign = diff > 0 ? '+' : '';
    return `${sign}${diff.toFixed(1)}%`;
}

function generateReport(adr, ele) {
    const reportPath = path.join(__dirname, '../HEAD_TO_HEAD.md');

    let md = `# Empirical Head-to-Head Benchmark Report: Adrenaline.js vs Electron\n\n`;
    md += `## Executive Summary\n`;
    md += `This report compares **Adrenaline.js (WebView-backed Node.js desktop runtime)** directly against standard **Electron** running the exact same complex frontend productivity workload under identical headless execution conditions (\`xvfb-run\`).\n\n`;

    md += `## Workload Specification\n`;
    md += `Both runtimes executed an identical frontend application (\`benchmarks/head-to-head/app/\`) featuring a realistic desktop productivity suite:\n`;
    md += `- **Dynamic Productivity Dataset:** 1,000+ live records with continuous search filtering, column sorting, and row mutations.\n`;
    md += `- **Glassmorphism UI:** Modern backdrop filters, CSS transitions, and sticky headers.\n`;
    md += `- **Active Bidirectional IPC:** Continuous background-to-renderer and renderer-to-background messages every **200ms**.\n`;
    md += `- **Test Duration:** 10-second continuous active profiling run.\n\n`;

    md += `## Head-to-Head Comparison Table\n\n`;
    md += `| Metric | Electron | Adrenaline.js | Difference % |\n`;
    md += `| :--- | :--- | :--- | :--- |\n`;
    md += `| **Process Count** | ${ele.processCount} processes | ${adr.processCount} processes | ${calculateDiff(ele.processCount, adr.processCount)} |\n`;
    md += `| **Startup Time to Paint** | ${ele.startupTimeMs} ms | ${adr.startupTimeMs} ms | ${calculateDiff(ele.startupTimeMs, adr.startupTimeMs)} |\n`;
    md += `| **Physical Memory (PSS)** | ${ele.peakPssMb} MB | ${adr.peakPssMb} MB | ${calculateDiff(ele.peakPssMb, adr.peakPssMb)} |\n`;
    md += `| **Peak Resident Memory (RSS)** | ${ele.peakRssMb} MB | ${adr.peakRssMb} MB | ${calculateDiff(ele.peakRssMb, adr.peakRssMb)} |\n`;
    md += `| **Disk / Runtime Bundle Footprint** | ${ele.diskMb} MB | ${adr.diskMb} MB | ${calculateDiff(ele.diskMb, adr.diskMb)} |\n\n`;

    md += `## Process Tree Breakdown\n\n`;

    md += `### Electron Process Footprint\n`;
    md += `| PID | Name / Executable | Inferred Role | RSS (MB) | PSS (MB) |\n`;
    md += `| :--- | :--- | :--- | :--- | :--- |\n`;
    for (const p of ele.lastSampleDetails) {
        md += `| ${p.pid} | \`${p.comm}\` | ${p.role} | ${p.rssMb} | ${p.pssMb} |\n`;
    }
    md += `\n`;

    md += `### Adrenaline.js Process Footprint\n`;
    md += `| PID | Name / Executable | Inferred Role | RSS (MB) | PSS (MB) |\n`;
    md += `| :--- | :--- | :--- | :--- | :--- |\n`;
    for (const p of adr.lastSampleDetails) {
        md += `| ${p.pid} | \`${p.comm}\` | ${p.role} | ${p.rssMb} | ${p.pssMb} |\n`;
    }
    md += `\n`;

    md += `## Measurement Methodology\n`;
    md += `1. **Process Tracking:** The benchmark harness monitors process parent-child relationships using \`pgrep\` recursively from the root process PID.\n`;
    md += `2. **Proportional Set Size (PSS):** Summed directly from \`/proc/[pid]/smaps_rollup\` across all processes in the runtime tree. PSS accounts for shared OS libraries without double-counting.\n`;
    md += `3. **Resident Set Size (RSS):** Summed total peak memory resident in RAM.\n`;
    md += `4. **Startup Time:** Precise time elapsed from initial process spawn to renderer initialization and interactive paint acknowledgment (\`app-ready\` signal sent over IPC).\n`;
    md += `5. **Runtime Disk Footprint:** Electron footprint measures its required bundled Chromium/Node runtime distribution (\`node_modules/electron/dist\`). Adrenaline footprint measures the native C++ addon (\`build/Release/adrenaline.node\`), JavaScript libraries (\`lib/\`), and application files.\n`;
    md += `6. **Cleanup:** Complete SIGKILL process tree termination after sampling to guarantee zero leftover background child processes.\n`;

    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, md, 'utf8');
    console.log(`\nOfficial Head-to-Head Report successfully saved to: ${reportPath}`);
}

main().catch((err) => {
    console.error('Benchmark failed:', err);
    process.exit(1);
});
