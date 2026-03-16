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
        timezone: '+00:00',
    },
    pool: {
        min: 2,
        max: 10,
        afterCreate: (conn, done) => {
            conn.query("SET time_zone = '+00:00'", (err) => done(err, conn));
        },
    },
};
export const db = knex(knexConfig);
export default db;
