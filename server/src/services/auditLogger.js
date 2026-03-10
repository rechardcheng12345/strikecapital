import { db } from '../config/database.js';
export async function logAudit(entry) {
    try {
        await db('audit_logs').insert({
            user_id: entry.userId ?? null,
            action: entry.action,
            entity_type: entry.entityType,
            entity_id: entry.entityId ?? null,
            old_values: entry.oldValues ? JSON.stringify(entry.oldValues) : null,
            new_values: entry.newValues ? JSON.stringify(entry.newValues) : null,
            ip_address: entry.ipAddress ?? null,
        });
    }
    catch (error) {
        console.error('[AuditLog] Failed to log:', error);
    }
}
