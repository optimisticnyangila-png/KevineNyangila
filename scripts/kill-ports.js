const { execFile } = require('child_process');

const ports = process.argv.slice(2)
    .map((port) => Number.parseInt(port, 10))
    .filter((port) => Number.isInteger(port) && port > 0);

function exec(command, args) {
    return new Promise((resolve) => {
        try {
            execFile(command, args, { windowsHide: true }, (error, stdout) => {
                resolve({ error, stdout: stdout || '' });
            });
        } catch (error) {
            resolve({ error, stdout: '' });
        }
    });
}

async function findWindowsPids(port) {
    const { stdout } = await exec('netstat.exe', ['-ano', '-p', 'tcp']);
    const pids = new Set();

    stdout.split(/\r?\n/).forEach((line) => {
        const columns = line.trim().split(/\s+/);
        if (columns.length < 5 || columns[0] !== 'TCP') return;

        const localAddress = columns[1];
        const state = columns[3];
        const pid = columns[4];
        if (state === 'LISTENING' && localAddress.endsWith(`:${port}`)) {
            pids.add(pid);
        }
    });

    return Array.from(pids);
}

async function killWindowsPid(pid) {
    await exec('taskkill.exe', ['/PID', pid, '/T', '/F']);
}

async function findUnixPids(port) {
    const { stdout } = await exec('lsof', ['-ti', `tcp:${port}`]);
    return stdout.split(/\s+/).filter(Boolean);
}

async function killUnixPid(pid) {
    await exec('kill', ['-9', pid]);
}

async function main() {
    if (ports.length === 0) {
        return;
    }

    const isWindows = process.platform === 'win32';
    for (const port of ports) {
        const pids = isWindows ? await findWindowsPids(port) : await findUnixPids(port);
        for (const pid of pids) {
            if (String(pid) === String(process.pid)) continue;
            if (isWindows) {
                await killWindowsPid(pid);
            } else {
                await killUnixPid(pid);
            }
        }
        if (pids.length > 0) {
            console.log(`Process on port ${port} killed`);
        }
    }
}

main().catch((error) => {
    console.warn(`Unable to clear ports: ${error.message}`);
});
