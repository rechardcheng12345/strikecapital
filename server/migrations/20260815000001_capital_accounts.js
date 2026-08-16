export async function up(knex) {
    await knex.schema.createTable('capital_movements', (t) => {
        t.increments('id').primary();
        t.integer('user_id').unsigned().notNullable().references('id').inTable('users');
        t.string('type', 20).notNullable();
        t.decimal('amount', 15, 2).notNullable();
        t.date('moved_on').notNullable();
        t.decimal('nav_before', 15, 2).nullable();
        t.text('note').nullable();
        t.integer('created_by').unsigned().references('id').inTable('users');
        t.timestamp('created_at').defaultTo(knex.fn.now());
        t.index(['user_id', 'moved_on']);
    });

    await knex.schema.createTable('ownership_periods', (t) => {
        t.increments('id').primary();
        t.integer('user_id').unsigned().notNullable().references('id').inTable('users');
        t.date('start_on').notNullable();
        t.date('end_on').nullable();
        t.decimal('ownership_pct', 8, 4).notNullable();
        t.decimal('capital_account', 15, 2).notNullable().defaultTo(0);
        t.timestamp('created_at').defaultTo(knex.fn.now());
        t.index(['user_id', 'start_on']);
        t.index(['end_on']);
    });

    const allocations = await knex('investor_allocations').where({ is_active: true });
    for (const a of allocations) {
        const start = a.start_date
            ? (a.start_date instanceof Date ? a.start_date.toISOString().slice(0, 10) : String(a.start_date).slice(0, 10))
            : new Date().toISOString().slice(0, 10);
        await knex('ownership_periods').insert({
            user_id: a.user_id,
            start_on: start,
            end_on: null,
            ownership_pct: a.allocation_pct || 0,
            capital_account: a.invested_amount || 0,
        });
        await knex('capital_movements').insert({
            user_id: a.user_id,
            type: 'contribution',
            amount: a.invested_amount || 0,
            moved_on: start,
            nav_before: 0,
            note: 'Opening capital (backfill)',
            created_by: a.created_by || null,
        });
    }
}

export async function down(knex) {
    await knex.schema.dropTableIfExists('ownership_periods');
    await knex.schema.dropTableIfExists('capital_movements');
}
