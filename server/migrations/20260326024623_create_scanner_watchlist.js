export async function up(knex) {
    await knex.schema.createTable('scanner_watchlist', (t) => {
        t.increments('id');
        t.string('ticker', 20).notNullable();
        t.integer('created_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
        t.timestamp('created_at').defaultTo(knex.fn.now());
        t.unique(['ticker']);
    });
}

export async function down(knex) {
    await knex.schema.dropTableIfExists('scanner_watchlist');
}
