// Backtesting: real daily option prices (Yahoo history of listed contracts + our own daily Moomoo mids),
// saved backtest runs, and a log of price-history loads.
export async function up(knex) {
    await knex.schema.createTable('bt_option_bars', (t) => {
        t.bigIncrements('id').primary();
        t.string('underlying', 20).notNullable();
        t.string('symbol', 40).notNullable(); // OCC style, e.g. SOXL280121P00060000
        t.date('expiry').notNullable();
        t.decimal('strike', 12, 4).notNullable();
        t.string('option_type', 4).notNullable().defaultTo('put');
        t.date('bar_date').notNullable();
        t.decimal('close', 12, 4).notNullable(); // Yahoo: last trade; moomoo_mid: (bid + ask) / 2 at the close
        t.integer('volume').nullable();
        t.string('source', 12).notNullable(); // yahoo | moomoo_mid
        t.unique(['symbol', 'bar_date', 'source']);
        t.index(['underlying', 'bar_date']);
    });
    await knex.schema.createTable('bt_runs', (t) => {
        t.increments('id').primary();
        t.string('name', 120).notNullable();
        t.string('ticker', 20).notNullable();
        t.text('params').notNullable();
        t.text('summary').notNullable();
        t.specificType('result', 'LONGTEXT').notNullable();
        t.integer('created_by').unsigned().nullable();
        t.timestamp('created_at').defaultTo(knex.fn.now());
    });
    await knex.schema.createTable('bt_data_loads', (t) => {
        t.increments('id').primary();
        t.string('ticker', 20).notNullable();
        t.string('kind', 12).notNullable(); // history | record
        t.dateTime('started_at').notNullable();
        t.dateTime('finished_at').nullable();
        t.integer('contracts').nullable();
        t.integer('bars').nullable();
        t.text('info').nullable();
    });
}

export async function down(knex) {
    await knex.schema.dropTableIfExists('bt_data_loads');
    await knex.schema.dropTableIfExists('bt_runs');
    await knex.schema.dropTableIfExists('bt_option_bars');
}
