// Snapshot of each open position's unrealized P&L at the moment capital is added, so profit already
// earned stays with the owners at that time even when the position closes after the add.
// capital_movements.undo_info records exactly what an add changed, so it can be reversed cleanly.
export async function up(knex) {
    await knex.schema.createTable('capital_movement_marks', (t) => {
        t.increments('id').primary();
        t.integer('movement_id').unsigned().notNullable().references('id').inTable('capital_movements').onDelete('CASCADE');
        t.integer('position_id').unsigned().notNullable();
        t.decimal('unrealized_pnl', 15, 2).notNullable();
        t.index(['position_id']);
    });
    await knex.schema.alterTable('capital_movements', (t) => {
        t.text('undo_info').nullable();
    });
}

export async function down(knex) {
    await knex.schema.alterTable('capital_movements', (t) => {
        t.dropColumn('undo_info');
    });
    await knex.schema.dropTableIfExists('capital_movement_marks');
}
