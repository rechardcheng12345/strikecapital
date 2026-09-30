// Option Alerts — saved criteria (tickers + DTE window) that list newly listed puts when checked.
// option_alert_contracts remembers every put an alert has seen, so new expiries / strikes stand out even
// when Moomoo gives no listing date.
export async function up(knex) {
    await knex.schema.createTable('option_alerts', (t) => {
        t.increments('id').primary();
        t.string('name', 100).notNullable();
        t.text('tickers').notNullable(); // JSON array of symbols
        t.integer('min_dte').notNullable();
        t.integer('max_dte').notNullable();
        t.integer('listed_within_days').notNullable().defaultTo(7);
        t.dateTime('last_checked_at').nullable();
        t.text('last_check_info').nullable(); // JSON: expiries per ticker, errors, counts
        t.integer('created_by').unsigned().nullable();
        t.timestamps(true, true);
    });
    await knex.schema.createTable('option_alert_contracts', (t) => {
        t.increments('id').primary();
        t.integer('alert_id').unsigned().notNullable().references('id').inTable('option_alerts').onDelete('CASCADE');
        t.string('ticker', 20).notNullable();
        t.string('option_code', 40).notNullable();
        t.date('expiry').notNullable();
        t.decimal('strike', 12, 4).notNullable();
        t.date('listed_on').nullable(); // Moomoo listTime
        t.string('listed_kind', 10).nullable(); // expiry | strike, from listing dates
        t.dateTime('first_seen_at').notNullable();
        t.string('first_seen_kind', 10).notNullable(); // baseline | expiry | strike
        t.boolean('dismissed').notNullable().defaultTo(false);
        t.decimal('bid', 12, 4).nullable();
        t.decimal('ask', 12, 4).nullable();
        t.decimal('last', 12, 4).nullable();
        t.decimal('implied_volatility', 10, 4).nullable();
        t.decimal('delta', 10, 6).nullable();
        t.integer('open_interest').nullable();
        t.integer('volume').nullable();
        t.decimal('stock_price', 12, 4).nullable();
        t.dateTime('quoted_at').nullable();
        t.unique(['alert_id', 'option_code']);
        t.index(['alert_id', 'ticker']);
    });
}

export async function down(knex) {
    await knex.schema.dropTableIfExists('option_alert_contracts');
    await knex.schema.dropTableIfExists('option_alerts');
}
