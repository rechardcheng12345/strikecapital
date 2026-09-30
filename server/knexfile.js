import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NODE_ENV = process.env.NODE_ENV || 'development';
const envFile = { production: '.env.production', staging: '.env.staging' }[NODE_ENV] || '.env';
dotenv.config({ path: path.resolve(__dirname, '..', envFile) });
const config = {
    development: {
        client: 'mysql2',
        connection: process.env.DATABASE_URL || {
            host: process.env.DB_HOST || 'localhost',
            port: parseInt(process.env.DB_PORT || '3306'),
            database: process.env.DB_NAME || 'strikecapital',
            user: process.env.DB_USER || 'root123',
            password: process.env.DB_PASSWORD || 'root321',
        },
        pool: {
            min: 2,
            max: 10,
        },
        migrations: {
            tableName: 'knex_migrations',
            directory: './migrations',
        },
        seeds: {
            directory: './seeds',
        },
    },
    production: {
        client: 'mysql2',
        connection: {
            host: process.env.DB_HOST,
            port: parseInt(process.env.DB_PORT || '3306'),
            database: process.env.DB_NAME,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
        },
        pool: {
            min: 2,
            max: 10,
        },
        migrations: {
            tableName: 'knex_migrations',
            directory: './migrations',
        },
        seeds: {
            directory: './seeds',
        },
    },
};
// Staging always reads .env.staging, whatever NODE_ENV is — `knex --env staging` must never reach the live DB.
const stagingFile = path.resolve(__dirname, '..', '.env.staging');
const stagingEnv = fs.existsSync(stagingFile) ? dotenv.parse(fs.readFileSync(stagingFile)) : {};
config.staging = {
    ...config.production,
    connection: {
        host: stagingEnv.DB_HOST,
        port: parseInt(stagingEnv.DB_PORT || '3306'),
        database: stagingEnv.DB_NAME,
        user: stagingEnv.DB_USER,
        password: stagingEnv.DB_PASSWORD,
    },
};
export default config;
