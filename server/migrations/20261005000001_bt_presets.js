// Saved backtest settings (named presets of the strategy form), shared by all admins.
export async function up(knex) {
    await knex.schema.createTable('bt_presets', (t) => {
        t.increments('id').primary();
        t.string('name', 120).notNullable().unique();
        t.text('params').notNullable();
        t.integer('created_by').unsigned().nullable();
        t.timestamps(true, true);
    });
}

export async function down(knex) {
    await knex.schema.dropTableIfExists('bt_presets');
}
