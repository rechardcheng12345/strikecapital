export async function up(knex) {
    await knex.schema.createTable('refresh_tokens', (table) => {
        table.increments('id').primary();
        table
            .integer('user_id')
            .unsigned()
            .references('id')
            .inTable('users')
            .onDelete('CASCADE')
            .notNullable();
        table.string('token', 255).notNullable();
        table.timestamp('expires_at').notNullable();
        table.timestamp('created_at').defaultTo(knex.fn.now());
        table.index('token');
        table.index('user_id');
    });
}
export async function down(knex) {
    await knex.schema.dropTableIfExists('refresh_tokens');
}
