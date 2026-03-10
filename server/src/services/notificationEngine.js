import { db } from '../config/database.js';
export async function createNotification(userId, type, title, message, metadata) {
    try {
        await db('notifications').insert({
            user_id: userId,
            type,
            title,
            message,
            metadata: metadata ? JSON.stringify(metadata) : null,
        });
    }
    catch (error) {
        console.error('[Notification] Failed to create:', error);
    }
}
export async function notifyAllInvestors(type, title, message, metadata) {
    try {
        const investors = await db('users').where({ role: 'investor', is_active: true }).select('id');
        if (investors.length === 0)
            return;
        const rows = investors.map((inv) => ({
            user_id: inv.id,
            type,
            title,
            message,
            metadata: metadata ? JSON.stringify(metadata) : null,
        }));
        await db('notifications').insert(rows);
    }
    catch (error) {
        console.error('[Notification] Failed to notify investors:', error);
    }
}
export async function checkExpiryAlerts() {
    try {
        const now = new Date();
        const thresholds = [
            { days: 7, label: '7 days' },
            { days: 3, label: '3 days' },
            { days: 1, label: '1 day' },
        ];
        for (const threshold of thresholds) {
            const targetDate = new Date(now);
            targetDate.setDate(targetDate.getDate() + threshold.days);
            const dateStr = targetDate.toISOString().split('T')[0];
            const expiringPositions = await db('positions')
                .whereIn('status', ['OPEN', 'MONITORING'])
                .where('expiration_date', dateStr)
                .select('id', 'ticker', 'strike_price', 'expiration_date');
            for (const pos of expiringPositions) {
                // Check if alert already sent
                const existing = await db('notifications')
                    .where('type', 'expiry_alert')
                    .whereRaw("metadata->>'position_id' = ?", [String(pos.id)])
                    .whereRaw("metadata->>'threshold' = ?", [threshold.label])
                    .first();
                if (!existing) {
                    await notifyAllInvestors('expiry_alert', `Expiry Alert: ${pos.ticker} $${pos.strike_price} Put`, `Position expires in ${threshold.label} (${pos.expiration_date})`, { position_id: pos.id, threshold: threshold.label });
                }
            }
        }
    }
    catch (error) {
        console.error('[ExpiryAlerts] Error checking:', error);
    }
}
let expiryInterval = null;
export function startExpiryAlertJob(intervalMinutes = 60) {
    console.log(`[ExpiryAlerts] Starting job every ${intervalMinutes} minutes`);
    checkExpiryAlerts();
    expiryInterval = setInterval(checkExpiryAlerts, intervalMinutes * 60 * 1000);
}
export function stopExpiryAlertJob() {
    if (expiryInterval) {
        clearInterval(expiryInterval);
        expiryInterval = null;
    }
}
