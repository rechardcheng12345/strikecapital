export async function up(knex) {
    await knex.schema.createTable('market_data_cache', (table) => {
        table.increments('id').primary();
        table.string('ticker', 20).unique().notNullable();
        table.decimal('current_price', 10, 2).notNullable();
        table.decimal('previous_close', 10, 2).nullable();
        table.decimal('day_change_pct', 6, 2).nullable();
        table.timestamp('fetched_at').notNullable();
        table.string('source', 50).defaultTo('manual');
        table.index('ticker');
        table.index('fetched_at');
    });
}
export async function down(knex) {
    await knex.schema.dropTableIfExists('market_data_cache');
}
