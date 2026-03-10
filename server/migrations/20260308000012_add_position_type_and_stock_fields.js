export async function up(knex) {
    await knex.schema.alterTable('positions', (table) => {
        table.string('position_type', 20).notNullable().defaultTo('option');
        table.integer('shares').nullable();
        table.decimal('cost_basis', 10, 2).nullable();
        table.integer('assigned_from_id').unsigned().references('id').inTable('positions').nullable();
        table.integer('assigned_to_id').unsigned().references('id').inTable('positions').nullable();
        table.index('position_type');
    });
    // Make expiration_date nullable for stock positions
    await knex.raw('ALTER TABLE positions ALTER COLUMN expiration_date DROP NOT NULL');
}
export async function down(knex) {
    await knex.raw("UPDATE positions SET expiration_date = CURRENT_DATE WHERE expiration_date IS NULL");
    await knex.raw('ALTER TABLE positions ALTER COLUMN expiration_date SET NOT NULL');
    await knex.schema.alterTable('positions', (table) => {
        table.dropColumn('position_type');
        table.dropColumn('shares');
        table.dropColumn('cost_basis');
        table.dropColumn('assigned_from_id');
        table.dropColumn('assigned_to_id');
    });
}
