import knex, { Knex } from 'knex';
import { env } from './env.js';

const knexConfig: Knex.Config = {
  client: 'postgresql',
  connection: env.databaseUrl || {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'strikecapital',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  },
  pool: {
    min: 2,
    max: 10,
  },
};

export const db = knex(knexConfig);

export default db;
