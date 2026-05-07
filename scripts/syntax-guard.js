const { execFileSync } = require('child_process');
const { join } = require('path');
const { readdirSync, statSync } = require('fs');

function collectJsFiles(dir) {
    return readdirSync(dir).flatMap((item) => {
        const fullPath = join(dir, item);
        if (statSync(fullPath).isDirectory()) {
            return collectJsFiles(fullPath);
        }
        return fullPath.endsWith('.js') ? [fullPath] : [];
    });
}

const root = join(__dirname, '..');
const backend = join(root, 'backend');
const files = collectJsFiles(root).filter((file) => !file.includes('node_modules'));

let failed = false;
for (const file of files) {
    try {
        execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
        console.log(`✔ ${file}`);
    } catch (error) {
        failed = true;
        console.error(`✖ Syntax error in ${file}`);
        console.error(error.stderr ? error.stderr.toString() : error.message);
    }
}

if (failed) {
    process.exit(1);
}