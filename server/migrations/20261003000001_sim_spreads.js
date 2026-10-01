// Paper-trading credit spreads (0DTE SPY / QQQ). A spread is one sim_positions row with position_type
// 'spread': short `strike`, `long_strike`, `option_type`; an iron condor is two rows sharing group_id.
// `monitor` (JSON) holds the underlying's day high/low at entry for the touch stop.
export async function up(knex) {
    await knex.schema.alterTable('sim_positions', (t) => {
        t.string('option_type', 4).notNullable().defaultTo('put');
        t.decimal('long_strike', 12, 4).nullable();
        t.string('group_id', 40).nullable();
        t.text('monitor').nullable();
        t.string('close_note', 255).nullable();
    });
    await knex.schema.alterTable('sim_portfolios', (t) => {
        t.string('spread_exit_rule', 10).notNullable().defaultTo('touch'); // touch | loss2x | hold
    });
}

export async function down(knex) {
    await knex.schema.alterTable('sim_portfolios', (t) => {
        t.dropColumn('spread_exit_rule');
    });
    await knex.schema.alterTable('sim_positions', (t) => {
        t.dropColumn('close_note');
        t.dropColumn('monitor');
        t.dropColumn('group_id');
        t.dropColumn('long_strike');
        t.dropColumn('option_type');
    });
}
