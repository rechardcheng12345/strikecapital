// Plain-English trading rules checked by Jev against each scanned ticker (e.g. "Avoid Chinese ADRs").
// action: 'block' vetoes matching tickers, 'warn' only flags them.
export async function up(knex) {
    await knex.schema.createTable('scanner_rules', (t) => {
        t.increments('id');
        t.string('rule_text', 300).notNullable();
        t.string('action', 10).notNullable().defaultTo('warn');
        t.boolean('is_active').notNullable().defaultTo(true);
        t.integer('created_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
        t.timestamp('created_at').defaultTo(knex.fn.now());
    });
}

export async function down(knex) {
    await knex.schema.dropTableIfExists('scanner_rules');
}
