import knex from 'knex';
import { env } from './env.js';
const knexConfig = {
    client: 'mysql2',
    connection: env.databaseUrl || {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '3306'),
        database: process.env.DB_NAME || 'strikecapital',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || 'root',
    },
    pool: {
        min: 2,
        max: 10,
    },
};
export const db = knex(knexConfig);
export default db;
