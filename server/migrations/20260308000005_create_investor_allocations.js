export async function up(knex) {
    await knex.schema.createTable('investor_allocations', (table) => {
        table.increments('id').primary();
        table
            .integer('user_id')
            .unsigned()
            .references('id')
            .inTable('users')
            .onDelete('CASCADE')
            .notNullable();
        table.decimal('invested_amount', 15, 2).notNullable().defaultTo(0);
        table.decimal('allocation_pct', 5, 2).notNullable().defaultTo(0);
        table.date('start_date').notNullable();
        table.date('end_date').nullable();
        table.boolean('is_active').defaultTo(true);
        table.text('notes').nullable();
        table
            .integer('created_by')
            .unsigned()
            .references('id')
            .inTable('users')
            .nullable();
        table.timestamp('created_at').defaultTo(knex.fn.now());
        table.timestamp('updated_at').defaultTo(knex.fn.now());
        table.index('user_id');
        table.index('is_active');
    });
}
export async function down(knex) {
    await knex.schema.dropTableIfExists('investor_allocations');
}
