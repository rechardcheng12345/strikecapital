export async function up(knex) {
    await knex.schema.alterTable('positions', (table) => {
        table.decimal('commission', 10, 2).defaultTo(0).after('premium_received');
        table.decimal('platform_fee', 10, 2).defaultTo(0).after('commission');
    });
}

export async function down(knex) {
    await knex.schema.alterTable('positions', (table) => {
        table.dropColumn('commission');
        table.dropColumn('platform_fee');
    });
}
