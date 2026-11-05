// Covered calls: an option position is a put (cash-secured) or a call written against shares the fund holds.
// covers_position_id → the open stock position whose shares cover the call (collateral 0: the shares are the cover).
export async function up(knex) {
    await knex.schema.alterTable('positions', (t) => {
        t.string('option_type', 4).notNullable().defaultTo('put');
        t.integer('covers_position_id').unsigned().nullable().references('id').inTable('positions');
    });
}
export async function down(knex) {
    await knex.schema.alterTable('positions', (t) => {
        t.dropForeign(['covers_position_id']);
        t.dropColumn('covers_position_id');
        t.dropColumn('option_type');
    });
}
