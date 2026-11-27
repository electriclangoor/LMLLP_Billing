// Copies the web page files into desktop/web so the Mac app carries its own copy.
// The signature (sign.png) and history backups are deliberately NOT copied:
// the signature is uploaded inside the app and stays on this Mac only.
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..');
const DEST = path.join(__dirname, 'web');
const FILES = [
  'index.html', 'app.js', 'style.css',
  'favicon.svg', 'favicon.png', 'apple-touch-icon.png',
  'doc-logo.png', 'logo-wide.png'
];
const DIRS = ['fonts'];

fs.rmSync(DEST, { recursive: true, force: true });
fs.mkdirSync(DEST, { recursive: true });
for (const f of FILES) fs.copyFileSync(path.join(SRC, f), path.join(DEST, f));
for (const d of DIRS) fs.cpSync(path.join(SRC, d), path.join(DEST, d), { recursive: true });
console.log(`Copied ${FILES.length} files and ${DIRS.length} folder(s) into desktop/web`);
