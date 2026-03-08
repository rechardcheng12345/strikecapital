import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('pnl_records', (table) => {
    table.increments('id').primary();
    table
      .integer('position_id')
      .unsigned()
      .references('id')
      .inTable('positions')
      .onDelete('CASCADE')
      .notNullable();
    table.date('record_date').notNullable();
    table.decimal('pnl_amount', 10, 2).notNullable();
    table.string('pnl_type', 30).notNullable();
    table.text('description').nullable();
    table
      .integer('created_by')
      .unsigned()
      .references('id')
      .inTable('users')
      .nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());

    table.index('position_id');
    table.index('record_date');
    table.index('pnl_type');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('pnl_records');
}
