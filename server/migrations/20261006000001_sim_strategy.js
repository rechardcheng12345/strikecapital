// Automatic strategy portfolios: a Simulation portfolio that runs a saved backtest setting every trading day.
// sim_portfolios.rules (already there) holds { preset_id, preset_name, ticker, run_at, params };
// rules_state is what the strategy remembers between days; sim_strategy_runs is the decision log.
export async function up(knex) {
    await knex.schema.alterTable('sim_portfolios', (t) => {
        t.text('rules_state').nullable();
    });
    await knex.schema.createTable('sim_strategy_runs', (t) => {
        t.increments('id').primary();
        t.integer('portfolio_id').unsigned().notNullable().references('id').inTable('sim_portfolios').onDelete('CASCADE');
        t.date('run_date').notNullable(); // New York trading date
        t.string('trigger', 10).notNullable(); // auto | manual
        t.string('status', 10).notNullable(); // ok | error
        t.decimal('underlying_price', 14, 4).nullable();
        t.text('message').nullable();
        t.text('actions').nullable(); // JSON: [{ kind, text, ok, error }]
        t.text('details').nullable(); // JSON: skipped reasons, equity, open puts
        t.timestamp('created_at').defaultTo(knex.fn.now());
        t.index(['portfolio_id', 'run_date']);
    });
}

export async function down(knex) {
    await knex.schema.dropTableIfExists('sim_strategy_runs');
    await knex.schema.alterTable('sim_portfolios', (t) => {
        t.dropColumn('rules_state');
    });
}
