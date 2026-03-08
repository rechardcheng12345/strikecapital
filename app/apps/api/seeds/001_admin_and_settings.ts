import type { Knex } from 'knex';
import bcrypt from 'bcryptjs';

export async function seed(knex: Knex): Promise<void> {
  // Clear existing entries
  await knex('fund_settings').del();
  await knex('users').del();

  // Insert admin user
  const passwordHash = await bcrypt.hash('admin123', 10);

  const [adminUser] = await knex('users')
    .insert({
      email: 'admin@strikecapital.com',
      password_hash: passwordHash,
      full_name: 'Admin User',
      role: 'admin',
      is_active: true,
    })
    .returning('id');

  // Insert default fund settings
  await knex('fund_settings').insert({
    fund_name: 'StrikeCapital by WYR',
    total_fund_capital: 480000.00,
    max_capital_per_position: 50000,
    max_positions: 20,
    default_alert_threshold: 5.00,
    updated_by: adminUser.id ?? adminUser,
  });
}
