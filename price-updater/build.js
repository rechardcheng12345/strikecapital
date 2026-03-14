/**
 * Build script: compiles price-updater into a standalone Windows .exe
 *
 * Steps:
 *   1. Pre-compile .proto files into a JSON descriptor (embeddable)
 *   2. Bundle all JS + deps into a single CJS file via esbuild
 *   3. Package into .exe via @yao-pkg/pkg
 *
 * Usage:
 *   npm run build
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import protobuf from 'protobufjs';
import esbuild from 'esbuild';
import { exec } from '@yao-pkg/pkg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Knex dynamically requires all DB drivers — we only use mysql2
const KNEX_UNUSED_DRIVERS = [
    'pg', 'pg-query-stream', 'better-sqlite3', 'sqlite3',
    'tedious', 'oracledb', 'mysql', 'pg-native',
];

async function build() {
    const distDir = path.join(__dirname, 'dist');
    if (!fs.existsSync(distDir)) fs.mkdirSync(distDir);

    // ─── Step 1: Compile protos to JSON ─────────────────
    console.log('[1/3] Compiling proto files to JSON...');
    const protoDir = path.join(__dirname, 'proto');
    const root = await protobuf.load([
        path.join(protoDir, 'Common.proto'),
        path.join(protoDir, 'InitConnect.proto'),
        path.join(protoDir, 'Qot_Common.proto'),
        path.join(protoDir, 'Qot_GetOptionChain.proto'),
        path.join(protoDir, 'Qot_GetSecuritySnapshot.proto'),
        path.join(protoDir, 'Qot_GetOptionExpirationDate.proto'),
        path.join(protoDir, 'Trd_Common.proto'),
        path.join(protoDir, 'Trd_GetAccList.proto'),
        path.join(protoDir, 'Trd_GetFunds.proto'),
        path.join(protoDir, 'Trd_UnlockTrade.proto'),
    ]);

    const protoJson = JSON.stringify(root.toJSON());
    const protoBundlePath = path.join(distDir, 'proto-bundle.json');
    fs.writeFileSync(protoBundlePath, protoJson);
    console.log(`   Proto bundle: ${(protoJson.length / 1024).toFixed(1)} KB`);

    // ─── Step 2: Bundle with esbuild ────────────────────
    console.log('[2/3] Bundling with esbuild...');
    const bundlePath = path.join(distDir, 'bundle.cjs');

    await esbuild.build({
        entryPoints: [path.join(__dirname, 'index.js')],
        bundle: true,
        platform: 'node',
        target: 'node18',
        format: 'cjs',
        outfile: bundlePath,
        // Mark unused knex DB drivers as external so they don't cause errors
        external: KNEX_UNUSED_DRIVERS,
        banner: {
            js: [
                `// StrikeCapital Price Updater - Built ${new Date().toISOString().split('T')[0]}`,
                `globalThis.__PROTO_BUNDLE__ = ${protoJson};`,
                '',
            ].join('\n'),
        },
        // import.meta.url is used for __dirname — provide a CJS shim
        define: {
            'import.meta.url': 'importMetaUrl',
        },
        inject: [path.join(distDir, '_shim.js')],
        logLevel: 'warning',
    });

    const bundleSize = fs.statSync(bundlePath).size;
    console.log(`   Bundle: ${(bundleSize / 1024 / 1024).toFixed(1)} MB`);

    // ─── Step 3: Package with pkg ───────────────────────
    console.log('[3/3] Packaging into .exe...');
    const exePath = path.join(distDir, 'price-updater.exe');

    await exec([
        bundlePath,
        '--target', 'node18-win-x64',
        '--output', exePath,
    ]);

    const exeSize = fs.statSync(exePath).size;
    console.log(`   Executable: ${(exeSize / 1024 / 1024).toFixed(1)} MB`);

    // Clean up shim
    fs.unlinkSync(path.join(distDir, '_shim.js'));

    console.log('');
    console.log('Build complete!');
    console.log(`Output: ${exePath}`);
    console.log('');
    console.log('To deploy:');
    console.log('  1. Copy dist/price-updater.exe to the target PC');
    console.log('  2. Create a .env file in the same folder (see .env.sample)');
    console.log('  3. Run: price-updater.exe');
    console.log('  4. Or for continuous mode: price-updater.exe --loop');
}

// Create the import.meta.url shim for CJS conversion
const shimPath = path.join(__dirname, 'dist', '_shim.js');
if (!fs.existsSync(path.join(__dirname, 'dist'))) fs.mkdirSync(path.join(__dirname, 'dist'));
fs.writeFileSync(shimPath, `export const importMetaUrl = require('url').pathToFileURL(__filename).href;\n`);

build().catch(err => {
    console.error('Build failed:', err.message);
    process.exit(1);
});
