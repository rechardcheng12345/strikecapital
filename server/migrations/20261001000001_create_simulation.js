// Paper-trading (simulation) portfolios — admin only, fully separate from the live fund's tables.
// Cash = starting_cash + SUM(sim_transactions.amount); sim_snapshots holds one value per portfolio per NY day.
export async function up(knex) {
    await knex.schema.createTable('sim_portfolios', (t) => {
        t.increments('id').primary();
        t.string('name', 100).notNullable();
        t.text('description').nullable();
        t.string('strategy_type', 20).notNullable().defaultTo('manual'); // manual | rules
        t.text('rules').nullable(); // JSON, for rule-based portfolios
        t.decimal('starting_cash', 15, 2).notNullable();
        t.decimal('fee_per_contract', 10, 4).notNullable().defaultTo(0);
        t.decimal('fee_per_stock_trade', 10, 4).notNullable().defaultTo(0);
        t.boolean('is_active').notNullable().defaultTo(true);
        t.integer('created_by').unsigned().nullable();
        t.timestamps(true, true);
    });
    await knex.schema.createTable('sim_positions', (t) => {
        t.increments('id').primary();
        t.integer('portfolio_id').unsigned().notNullable().references('id').inTable('sim_portfolios').onDelete('CASCADE');
        t.string('position_type', 10).notNullable(); // option (short put) | stock
        t.string('ticker', 20).notNullable(); // underlying symbol
        t.decimal('strike', 12, 4).nullable();
        t.date('expiration_date').nullable();
        t.integer('contracts').nullable();
        t.integer('shares').nullable();
        t.decimal('entry_price', 12, 4).notNullable(); // per share: fill mid for a put, cost basis for stock
        t.string('entry_source', 10).nullable(); // mid | last | manual | scanner | assigned
        t.decimal('entry_fees', 10, 2).notNullable().defaultTo(0);
        t.date('open_date').notNullable();
        t.decimal('current_price', 12, 4).nullable();
        t.decimal('current_bid', 12, 4).nullable();
        t.decimal('current_ask', 12, 4).nullable();
        t.string('price_source', 10).nullable();
        t.dateTime('price_updated_at').nullable();
        t.decimal('underlying_price', 12, 4).nullable();
        t.string('status', 10).notNullable().defaultTo('OPEN'); // OPEN | CLOSED
        t.string('close_reason', 20).nullable(); // bought_to_close | expired | assigned | rolled | sold
        t.decimal('close_price', 12, 4).nullable();
        t.decimal('exit_fees', 10, 2).nullable();
        t.date('close_date').nullable();
        t.decimal('realized_pnl', 15, 2).nullable();
        t.integer('rolled_from_id').unsigned().nullable();
        t.integer('rolled_to_id').unsigned().nullable();
        t.integer('assigned_from_id').unsigned().nullable();
        t.text('entry_context').nullable(); // JSON: score, jev, delta, sigma, iv/hv … at entry
        t.text('notes').nullable();
        t.timestamps(true, true);
        t.index(['portfolio_id', 'status']);
    });
    await knex.schema.createTable('sim_transactions', (t) => {
        t.increments('id').primary();
        t.integer('portfolio_id').unsigned().notNullable().references('id').inTable('sim_portfolios').onDelete('CASCADE');
        t.integer('position_id').unsigned().nullable();
        t.string('type', 20).notNullable(); // sell_to_open | buy_to_close | assigned | sell_stock
        t.decimal('amount', 15, 2).notNullable(); // signed cash change, fees included
        t.decimal('fees', 10, 2).notNullable().defaultTo(0);
        t.string('description', 255).nullable();
        t.timestamp('created_at').defaultTo(knex.fn.now());
        t.index(['portfolio_id']);
    });
    await knex.schema.createTable('sim_snapshots', (t) => {
        t.increments('id').primary();
        t.integer('portfolio_id').unsigned().notNullable().references('id').inTable('sim_portfolios').onDelete('CASCADE');
        t.date('snap_date').notNullable(); // New York date
        t.decimal('cash', 15, 2).notNullable();
        t.decimal('collateral', 15, 2).notNullable();
        t.decimal('realized', 15, 2).notNullable();
        t.decimal('unrealized', 15, 2).notNullable();
        t.decimal('total_value', 15, 2).notNullable();
        t.decimal('spy_price', 12, 4).nullable();
        t.timestamp('updated_at').defaultTo(knex.fn.now());
        t.unique(['portfolio_id', 'snap_date']);
    });
}

export async function down(knex) {
    await knex.schema.dropTableIfExists('sim_snapshots');
    await knex.schema.dropTableIfExists('sim_transactions');
    await knex.schema.dropTableIfExists('sim_positions');
    await knex.schema.dropTableIfExists('sim_portfolios');
}
