import bcrypt from 'bcryptjs';
import knex from 'knex';

const db = knex({
  client: 'pg',
  connection: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'strikecapital',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  },
});

const hash = await bcrypt.hash('investor123', 10);
const result = await db('users')
  .where({ email: 'investor@strikecapital.com' })
  .update({ password_hash: hash });

if (result) {
  console.log('OK - investor@strikecapital.com password reset to: investor123');
} else {
  console.log('No investor user found');
}

await db.destroy();
