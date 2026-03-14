export async function up(knex) {
    await knex.schema.createTable('account_funds_cache', (table) => {
        table.increments('id').primary();
        table.string('acc_id', 50).unique().notNullable();
        table.integer('trd_market').nullable();
        table.decimal('power', 16, 2).defaultTo(0);
        table.decimal('total_assets', 16, 2).defaultTo(0);
        table.decimal('cash', 16, 2).defaultTo(0);
        table.decimal('market_val', 16, 2).defaultTo(0);
        table.decimal('frozen_cash', 16, 2).defaultTo(0);
        table.decimal('debt_cash', 16, 2).defaultTo(0);
        table.decimal('avl_withdrawal_cash', 16, 2).defaultTo(0);
        table.decimal('max_power_short', 16, 2).nullable();
        table.decimal('net_cash_power', 16, 2).nullable();
        table.decimal('long_mv', 16, 2).nullable();
        table.decimal('short_mv', 16, 2).nullable();
        table.decimal('pending_asset', 16, 2).nullable();
        table.decimal('max_withdrawal', 16, 2).nullable();
        table.integer('risk_level').nullable();
        table.integer('risk_status').nullable();
        table.decimal('margin_call_margin', 16, 2).nullable();
        table.decimal('unrealized_pl', 16, 2).nullable();
        table.decimal('realized_pl', 16, 2).nullable();
        table.decimal('initial_margin', 16, 2).nullable();
        table.decimal('maintenance_margin', 16, 2).nullable();
        table.boolean('is_pdt').defaultTo(false);
        table.string('pdt_seq', 20).nullable();
        table.decimal('beginning_dtbp', 16, 2).nullable();
        table.decimal('remaining_dtbp', 16, 2).nullable();
        table.decimal('dt_call_amount', 16, 2).nullable();
        table.integer('dt_status').nullable();
        table.decimal('securities_assets', 16, 2).nullable();
        table.decimal('fund_assets', 16, 2).nullable();
        table.decimal('bond_assets', 16, 2).nullable();
        table.integer('currency').nullable();
        table.timestamp('fetched_at').notNullable();
        table.index('acc_id');
        table.index('fetched_at');
    });
}

export async function down(knex) {
    await knex.schema.dropTableIfExists('account_funds_cache');
}
