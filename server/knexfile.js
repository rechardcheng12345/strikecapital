import dotenv from 'dotenv';
dotenv.config();
const config = {
    development: {
        client: 'mysql2',
        connection: process.env.DATABASE_URL || {
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
        connection: process.env.DATABASE_URL,
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
export default config;
