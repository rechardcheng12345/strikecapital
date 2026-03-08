import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('positions', (table) => {
    table.increments('id').primary();
    table.string('ticker', 20).notNullable();
    table.decimal('strike_price', 10, 2).notNullable();
    table.decimal('premium_received', 10, 2).notNullable();
    table.integer('contracts').notNullable().defaultTo(1);
    table.date('expiration_date').notNullable();
    table.date('open_date').notNullable().defaultTo(knex.raw('CURRENT_DATE'));
    table.date('close_date').nullable();
    table.string('status', 20).notNullable().defaultTo('OPEN');
    table.string('resolution_type', 30).nullable();
    table.decimal('current_price', 10, 2).nullable();
    table.decimal('implied_volatility', 8, 4).nullable();
    table.timestamp('last_price_update').nullable();
    table.decimal('collateral', 15, 2).notNullable();
    table.decimal('break_even', 10, 2).notNullable();
    table.decimal('max_profit', 10, 2).notNullable();
    table.decimal('realized_pnl', 10, 2).nullable();
    table.decimal('close_premium', 10, 2).nullable();
    table.decimal('assignment_loss', 10, 2).nullable();
    table
      .integer('rolled_from_id')
      .unsigned()
      .references('id')
      .inTable('positions')
      .nullable();
    table
      .integer('rolled_to_id')
      .unsigned()
      .references('id')
      .inTable('positions')
      .nullable();
    table.text('notes').nullable();
    table
      .integer('created_by')
      .unsigned()
      .references('id')
      .inTable('users')
      .notNullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());

    table.index('ticker');
    table.index('status');
    table.index('expiration_date');
    table.index('open_date');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('positions');
}
