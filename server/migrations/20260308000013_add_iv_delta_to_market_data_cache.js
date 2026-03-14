export async function up(knex) {
    await knex.schema.alterTable('market_data_cache', (table) => {
        table.decimal('implied_volatility', 8, 4).nullable();
        table.decimal('delta', 8, 4).nullable();
    });
}

export async function down(knex) {
    await knex.schema.alterTable('market_data_cache', (table) => {
        table.dropColumn('implied_volatility');
        table.dropColumn('delta');
    });
}
