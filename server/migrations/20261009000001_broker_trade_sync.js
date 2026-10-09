export async function up(knex) {
    await knex.schema.createTable('broker_sync_state', t => {
        t.string('id', 40).primary();
        t.string('account_id', 40).nullable();
        t.string('start_date', 10).nullable();
    });
    await knex('broker_sync_state').insert({ id: 'moomoo' });
    await knex.schema.createTable('broker_synced_fills', t => {
        t.string('account_id', 40).notNullable();
        t.string('fill_id', 40).notNullable();
        t.integer('position_id').unsigned().nullable();
        t.string('action', 20).notNullable();
        t.timestamp('created_at').defaultTo(knex.fn.now());
        t.primary(['account_id', 'fill_id']);
    });
}
export async function down(knex) {
    await knex.schema.dropTableIfExists('broker_synced_fills');
    await knex.schema.dropTableIfExists('broker_sync_state');
}
