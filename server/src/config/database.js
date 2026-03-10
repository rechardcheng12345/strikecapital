import knex from 'knex';
import { env } from './env.js';
const knexConfig = {
    client: 'mysql2',
    connection: {
        host:     env.dbHost,
        port:     env.dbPort,
        database: env.dbName,
        user:     env.dbUser,
        password: env.dbPassword,
    },
    pool: {
        min: 2,
        max: 10,
    },
};
export const db = knex(knexConfig);
export default db;
