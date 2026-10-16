'use strict';
// Builds a standalone app for the current OS using Node's single executable applications feature:
// a copy of the node binary with server.js and public/ embedded. Run with `npm run build`.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { inject } = require('postject');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const PUBLIC_DIR = path.join(ROOT, 'public');
const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const EXE = path.join(DIST, 'YT-Downloader' + (IS_WIN ? '.exe' : ''));
const BLOB = path.join(DIST, 'sea-prep.blob');
const CONFIG = path.join(DIST, 'sea-config.json');

async function main() {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Building needs Node.js 22 or newer.');

  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  const assets = {};
  for (const name of fs.readdirSync(PUBLIC_DIR)) assets[name] = path.join(PUBLIC_DIR, name);
  fs.writeFileSync(CONFIG, JSON.stringify({
    main: path.join(ROOT, 'server.js'),
    output: BLOB,
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false,
    assets,
  }, null, 2));

  console.log('Creating app bundle…');
  execFileSync(process.execPath, ['--experimental-sea-config', CONFIG], { stdio: 'inherit' });

  console.log('Copying Node.js…');
  fs.copyFileSync(process.execPath, EXE);
  if (IS_MAC) execFileSync('codesign', ['--remove-signature', EXE], { stdio: 'inherit' });

  console.log('Embedding app…');
  await inject(EXE, 'NODE_SEA_BLOB', fs.readFileSync(BLOB), {
    sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
    ...(IS_MAC ? { machoSegmentName: 'NODE_SEA' } : {}),
  });

  if (IS_MAC) {
    // Apple Silicon refuses to run unsigned binaries; an ad-hoc signature is enough.
    execFileSync('codesign', ['--sign', '-', EXE], { stdio: 'inherit' });
    const zip = path.join(DIST, `YT-Downloader-mac-${process.arch}.zip`);
    execFileSync('ditto', ['-c', '-k', '--keepParent', EXE, zip], { stdio: 'inherit' });
  }

  fs.rmSync(BLOB, { force: true });
  fs.rmSync(CONFIG, { force: true });
  console.log(`\nDone: ${path.relative(ROOT, DIST)}${path.sep}`);
  for (const f of fs.readdirSync(DIST)) console.log(`  ${f}  (${(fs.statSync(path.join(DIST, f)).size / 1048576).toFixed(0)} MB)`);
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
