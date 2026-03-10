export async function up(knex) {
    await knex.schema.createTable('audit_logs', (table) => {
        table.increments('id').primary();
        table
            .integer('user_id')
            .unsigned()
            .references('id')
            .inTable('users')
            .onDelete('SET NULL')
            .nullable();
        table.string('action', 100).notNullable();
        table.string('entity_type', 50).notNullable();
        table.integer('entity_id').nullable();
        table.json('old_values').nullable();
        table.json('new_values').nullable();
        table.string('ip_address', 45).nullable();
        table.timestamp('created_at').defaultTo(knex.fn.now());
        table.index('user_id');
        table.index('action');
        table.index('entity_type');
        table.index('created_at');
    });
}
export async function down(knex) {
    await knex.schema.dropTableIfExists('audit_logs');
}
