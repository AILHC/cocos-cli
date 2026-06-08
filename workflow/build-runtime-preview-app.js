const { cpSync, existsSync, mkdirSync, rmSync } = require('fs');
const { join } = require('path');

const workspace = join(__dirname, '..');
const source = join(workspace, 'src', 'runtime-preview', 'preview-app', 'dist');
const target = join(workspace, 'static', 'runtime-preview', 'preview-app');

if (!existsSync(source)) {
    throw new Error(`Runtime preview app dist not found: ${source}`);
}

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(source, target, { recursive: true });
console.log(`Runtime preview app copied to ${target}`);
