import { randomBytes } from 'node:crypto';
import { db } from '../config/database.js';
import { env } from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';
import { allowedEvents, wantsEvent, parseEvents, publishNtfy, summaryPeriod } from './notificationPolicy.js';
import { investorStatement, sumFundRealizedPnl, sumFundUnrealizedPnl } from './capitalAccountService.js';

export async function preferencesFor(user) {
    let row = await db('notification_preferences').where({ user_id: user.id }).first();
    if (!row) {
        await db('notification_preferences').insert({
            user_id: user.id, enabled: false, topic: `strike-${randomBytes(24).toString('hex')}`,
            events: JSON.stringify(allowedEvents(user.role).map((e) => e.value)), summary_frequency: 'weekly',
        }).onConflict('user_id').ignore();
        row = await db('notification_preferences').where({ user_id: user.id }).first();
    }
    return {
        enabled: Boolean(row.enabled), topic: row.topic, events: parseEvents(row.events),
        summary_frequency: row.summary_frequency, available_events: allowedEvents(user.role),
        server_url: env.ntfyServerUrl, configured: env.ntfyEnabled,
    };
}

export async function savePreferences(user, input) {
    await preferencesFor(user);
    const allowed = new Set(allowedEvents(user.role).map((e) => e.value));
    if (input.events.some((e) => !allowed.has(e))) {
        throw new AppError('One or more notification events are unavailable for your role', 403);
    }
    await db('notification_preferences').where({ user_id: user.id }).update({
        enabled: input.enabled, events: JSON.stringify([...new Set(input.events)]),
        summary_frequency: input.summary_frequency, updated_at: new Date(),
    });
    return preferencesFor(user);
}

// Send event details to personal ntfy topics, as explicitly requested by the platform owner.
export async function enqueuePush(userId, event, title, message, path, dedupeKey = null) {
    await db('notification_deliveries').insert({ user_id: userId, event, title, message, path, dedupe_key: dedupeKey })
        .onConflict('dedupe_key').ignore();
}

export async function queueEventForUser(user, type, title, message) {
    if (!env.ntfyEnabled) return;
    const settings = await db('notification_preferences').where({ user_id: user.id }).first();
    if (!user.is_active || !wantsEvent(settings, user.role, type)) return;
    const event = allowedEvents(user.role).find((e) => e.value === type);
    await enqueuePush(user.id, type, `StrikeCapital: ${title || event.label}`.slice(0, 255),
        message || `${event.label} update`,
        type === 'simulation_result' ? '/admin/simulation' : type === 'backtest_result' ? '/admin/backtest' : user.role === 'admin' ? '/admin/profile' : '/profile');
}

export async function notifyAdmins(type, title, message, metadata) {
    if (!env.ntfyEnabled) return;
    try {
        const users = await db('users').where({ role: 'admin', is_active: true }).select('id', 'role', 'is_active');
        for (const user of users) {
            const settings = await db('notification_preferences').where({ user_id: user.id }).first();
            if (!wantsEvent(settings, user.role, type)) continue;
            await db('notifications').insert({ user_id: user.id, type, title, message, metadata: JSON.stringify(metadata || {}) });
            await queueEventForUser(user, type, title, message);
        }
    } catch (error) { console.error('[ntfy] Failed to record admin event:', error.message); }
}

const money = (n) => Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
export async function queueAccountSummary(user, dedupeKey = null) {
    const settings = await db('notification_preferences').where({ user_id: user.id }).first();
    if (!env.ntfyEnabled || !user.is_active || !wantsEvent(settings, user.role, 'account_summary')) return false;
    if (dedupeKey && await db('notification_deliveries').where({ dedupe_key: dedupeKey }).first()) return false;
    let message;
    if (user.role === 'investor') {
        const s = await investorStatement(user.id);
        message = `Net invested: ${money(s.invested)}. Account value: ${money(s.value)}. Realized P&L: ${money(s.realized)}. Unrealized P&L: ${money(s.unrealized)}.`;
    } else {
        const fund = await db('fund_settings').first();
        const realized = await sumFundRealizedPnl();
        const unrealized = await sumFundUnrealizedPnl();
        message = `Fund capital: ${money(fund?.total_fund_capital || 0)}. Realized P&L: ${money(realized)}. Unrealized P&L: ${money(unrealized)}.`;
    }
    const latest = await db('positions').whereNotNull('last_price_update').orderBy('last_price_update', 'desc').first('last_price_update');
    message += ` Based on cached prices; last update: ${latest?.last_price_update ? new Date(latest.last_price_update).toISOString() : 'unavailable'}.`;
    return db.transaction(async (trx) => {
        const [id] = await trx('notification_deliveries').insert({
            user_id: user.id, event: 'account_summary', title: 'StrikeCapital: Account summary',
            message,
            path: user.role === 'admin' ? '/admin/profile' : '/profile', dedupe_key: dedupeKey,
        }).onConflict('dedupe_key').ignore();
        if (!id) return false;
        await trx('notifications').insert({ user_id: user.id, type: 'account_summary', title: 'Account summary', message });
        return true;
    });
}

let busy = false;
export async function processNotifications() {
    if (busy || !env.ntfyEnabled) return;
    busy = true;
    try {
        // Recover a delivery abandoned by a process restart after the lease expires.
        await db('notification_deliveries').where({ status: 'sending' }).where('available_at', '<=', new Date())
            .update({ status: 'pending' });
        const candidates = await db('notification_deliveries').where({ status: 'pending' })
            .where('available_at', '<=', new Date()).orderBy('id').limit(10);
        for (const row of candidates) {
            const claimed = await db('notification_deliveries').where({ id: row.id, status: 'pending' })
                .update({ status: 'sending', available_at: new Date(Date.now() + 120000) });
            if (!claimed) continue;
            try {
                const user = await db('users').where({ id: row.user_id }).first();
                const prefs = await db('notification_preferences').where({ user_id: row.user_id }).first();
                if (!user?.is_active || !prefs?.enabled || (row.event !== 'test' && !wantsEvent(prefs, user.role, row.event))) {
                    await db('notification_deliveries').where({ id: row.id }).update({ status: 'cancelled' });
                    continue;
                }
                await publishNtfy({ serverUrl: env.ntfyServerUrl, token: env.ntfyToken, topic: prefs.topic,
                    title: row.title, message: row.message, click: new URL(row.path, env.frontendUrl).href });
                await db('notification_deliveries').where({ id: row.id }).update({ status: 'sent', sent_at: new Date(), attempts: row.attempts + 1, last_error: null });
            } catch (error) {
                const attempts = row.attempts + 1;
                await db('notification_deliveries').where({ id: row.id }).update({
                    status: attempts >= 5 ? 'failed' : 'pending', attempts,
                    available_at: new Date(Date.now() + Math.max(error.retryAfterMs || 0, Math.min(3600000, 60000 * 2 ** attempts))),
                    last_error: error.message.slice(0, 255),
                });
            }
        }
    } catch (error) { console.error('[ntfy] Worker error:', error.message); }
    finally { busy = false; }
}

let summaryBusy = false;
async function scheduledSummaries() {
    if (summaryBusy || !env.ntfyEnabled) return;
    summaryBusy = true;
    try {
        const users = await db('users').join('notification_preferences as p', 'users.id', 'p.user_id')
            .where('users.is_active', true).where('p.enabled', true).select('users.*', 'p.summary_frequency');
        for (const user of users) {
            const period = summaryPeriod(user.summary_frequency);
            if (period) await queueAccountSummary(user, `summary:${user.id}:${period}`);
        }
    } catch (error) { console.error('[ntfy] Summary job error:', error.message); }
    finally { summaryBusy = false; }
}

export function startNotificationJobs() {
    if (!env.ntfyEnabled) return;
    processNotifications();
    scheduledSummaries();
    setInterval(processNotifications, 30000).unref();
    setInterval(scheduledSummaries, 5 * 60000).unref();
}
