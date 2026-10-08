export async function up(knex) {
    await knex.schema.createTable('notification_preferences', (t) => {
        t.integer('user_id').unsigned().primary().references('id').inTable('users').onDelete('CASCADE');
        t.boolean('enabled').notNullable().defaultTo(false);
        t.string('topic', 100).notNullable().unique();
        t.json('events').notNullable();
        t.string('summary_frequency', 10).notNullable().defaultTo('weekly');
        t.timestamp('updated_at').defaultTo(knex.fn.now());
    });
    await knex.schema.createTable('notification_deliveries', (t) => {
        t.increments('id').primary();
        t.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
        t.string('event', 30).notNullable();
        t.string('dedupe_key', 150).nullable().unique();
        t.string('title', 255).notNullable();
        t.text('message').notNullable();
        t.string('path', 255).notNullable();
        t.string('status', 15).notNullable().defaultTo('pending');
        t.integer('attempts').notNullable().defaultTo(0);
        t.timestamp('available_at').notNullable().defaultTo(knex.fn.now());
        t.timestamp('sent_at').nullable();
        t.string('last_error', 255).nullable();
        t.timestamp('created_at').defaultTo(knex.fn.now());
        t.index(['status', 'available_at']);
        t.index(['user_id', 'created_at']);
    });
}

export async function down(knex) {
    await knex.schema.dropTableIfExists('notification_deliveries');
    await knex.schema.dropTableIfExists('notification_preferences');
}
