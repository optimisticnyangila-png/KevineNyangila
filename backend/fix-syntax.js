const fs = require('fs');
const path = require('path');

function fixOptionalChaining(dir) {
    const files = fs.readdirSync(dir, { withFileTypes: true });

    for (const file of files) {
        const fullPath = path.join(dir, file.name);

        if (file.isDirectory() && !file.name.startsWith('.') && file.name !== 'node_modules') {
            fixOptionalChaining(fullPath);
        } else if (file.isFile() && file.name.endsWith('.js')) {
            let content = fs.readFileSync(fullPath, 'utf8');
            const originalContent = content;

            // Fix optional chaining syntax
            content = content.replace(/\?\s+\./g, '?.');

            if (content !== originalContent) {
                fs.writeFileSync(fullPath, content);
                console.log(`Fixed: ${fullPath}`);
            }
        }
    }
}

fixOptionalChaining('.');

console.log('All optional chaining syntax fixed!');