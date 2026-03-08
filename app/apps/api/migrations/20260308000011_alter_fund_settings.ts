import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('fund_settings', (table) => {
    table.decimal('max_capital_per_position', 15, 2).defaultTo(50000);
    table.integer('max_positions').defaultTo(20);
    table.decimal('default_alert_threshold', 5, 2).defaultTo(5.00);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('fund_settings', (table) => {
    table.dropColumn('max_capital_per_position');
    table.dropColumn('max_positions');
    table.dropColumn('default_alert_threshold');
  });
}
