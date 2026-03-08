import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('fund_settings', (table) => {
    table.increments('id').primary();
    table.string('fund_name', 255).defaultTo('StrikeCapital by WYR');
    table.decimal('total_fund_capital', 15, 2).notNullable().defaultTo(0);
    table.decimal('max_capital_utilization', 5, 2).defaultTo(80.00);
    table.decimal('max_single_position', 5, 2).defaultTo(15.00);
    table.decimal('max_ticker_concentration', 5, 2).defaultTo(25.00);
    table.decimal('risk_free_rate', 5, 4).defaultTo(0.0525);
    table
      .integer('updated_by')
      .unsigned()
      .references('id')
      .inTable('users')
      .nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('fund_settings');
}
