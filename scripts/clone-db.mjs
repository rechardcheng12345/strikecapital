// Clone one MySQL/MariaDB database into another (schema + data).
// Usage: node scripts/clone-db.mjs [sourceEnv] [targetEnv]   (defaults: .env → .env.staging)
// The target DB must already exist (create it in Hostinger hPanel) and its name must
// contain "staging" — every table in it is dropped and recreated from the source.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [sourceFile = '.env', targetFile = '.env.staging'] = process.argv.slice(2);
const BATCH = 500;

function loadDb(file) {
    const full = path.resolve(root, file);
    if (!fs.existsSync(full)) throw new Error(`Env file not found: ${full}`);
    const e = dotenv.parse(fs.readFileSync(full));
    for (const k of ['DB_HOST', 'DB_NAME', 'DB_USER']) {
        if (!e[k]) throw new Error(`${file} is missing ${k}`);
    }
    return {
        host: e.DB_HOST, port: parseInt(e.DB_PORT || '3306', 10),
        user: e.DB_USER, password: e.DB_PASSWORD || '', database: e.DB_NAME,
        multipleStatements: false, dateStrings: true, supportBigNumbers: true, bigNumberStrings: true,
    };
}

const src = loadDb(sourceFile);
const dst = loadDb(targetFile);
if (!/staging/i.test(dst.database)) throw new Error(`Refusing: target DB "${dst.database}" does not contain "staging"`);
if (src.host === dst.host && src.database === dst.database) throw new Error('Source and target are the same database');

console.log(`Cloning ${src.database}@${src.host} → ${dst.database}@${dst.host}`);
const s = await mysql.createConnection(src);
const d = await mysql.createConnection(dst);
await s.query("SET time_zone = '+00:00'");
await d.query("SET time_zone = '+00:00', FOREIGN_KEY_CHECKS = 0, UNIQUE_CHECKS = 0, SQL_MODE = 'NO_AUTO_VALUE_ON_ZERO'");

try {
    const [existing] = await d.query("SELECT table_name AS t, table_type AS k FROM information_schema.tables WHERE table_schema = DATABASE()");
    for (const { t, k } of existing) {
        await d.query(`DROP ${k === 'VIEW' ? 'VIEW' : 'TABLE'} IF EXISTS \`${t}\``);
    }

    const [tables] = await s.query("SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' ORDER BY table_name");
    for (const { t } of tables) {
        const [[{ 'Create Table': ddl }]] = await s.query(`SHOW CREATE TABLE \`${t}\``);
        await d.query(ddl);

        const [rows] = await s.query(`SELECT * FROM \`${t}\``);
        for (let i = 0; i < rows.length; i += BATCH) {
            const chunk = rows.slice(i, i + BATCH);
            const cols = Object.keys(chunk[0]);
            await d.query(
                `INSERT INTO \`${t}\` (${cols.map(c => `\`${c}\``).join(',')}) VALUES ?`,
                [chunk.map(r => cols.map(c => r[c]))],
            );
        }
        console.log(`  ${t}: ${rows.length} rows`);
    }

    const [views] = await s.query("SELECT table_name AS t FROM information_schema.views WHERE table_schema = DATABASE()");
    for (const { t } of views) {
        const [[row]] = await s.query(`SHOW CREATE VIEW \`${t}\``);
        await d.query(row['Create View'].replace(/DEFINER=`[^`]+`@`[^`]+`\s*/, ''));
        console.log(`  view ${t}`);
    }

    // Row-count check
    let mismatch = 0;
    for (const { t } of tables) {
        const [[a]] = await s.query(`SELECT COUNT(*) n FROM \`${t}\``);
        const [[b]] = await d.query(`SELECT COUNT(*) n FROM \`${t}\``);
        if (String(a.n) !== String(b.n)) { mismatch++; console.error(`  MISMATCH ${t}: ${a.n} vs ${b.n}`); }
    }
    console.log(mismatch ? `Done with ${mismatch} mismatched table(s)` : `Done — ${tables.length} tables, row counts match`);
} finally {
    await d.query('SET FOREIGN_KEY_CHECKS = 1, UNIQUE_CHECKS = 1');
    await s.end();
    await d.end();
}
