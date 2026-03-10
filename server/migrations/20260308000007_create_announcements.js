export async function up(knex) {
    await knex.schema.createTable('announcements', (table) => {
        table.increments('id').primary();
        table.string('title', 255).notNullable();
        table.text('content').notNullable();
        table.string('priority', 20).defaultTo('normal');
        table.boolean('is_active').defaultTo(true);
        table.timestamp('published_at').nullable();
        table.timestamp('expires_at').nullable();
        table
            .integer('created_by')
            .unsigned()
            .references('id')
            .inTable('users')
            .notNullable();
        table.timestamp('created_at').defaultTo(knex.fn.now());
        table.timestamp('updated_at').defaultTo(knex.fn.now());
        table.index('is_active');
        table.index('published_at');
    });
}
export async function down(knex) {
    await knex.schema.dropTableIfExists('announcements');
}
