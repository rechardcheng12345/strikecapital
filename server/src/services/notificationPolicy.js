export const NOTIFICATION_EVENTS = {
    position_opened: { label: 'Positions opened / assignments' },
    position_resolved: { label: 'Positions resolved' },
    position_rolled: { label: 'Positions rolled' },
    expiry_alert: { label: 'Position expiry alerts' },
    announcement: { label: 'Announcements' },
    account_summary: { label: 'Account summary' },
    simulation_result: { label: 'Simulation strategy results', adminOnly: true },
    backtest_result: { label: 'Backtest results', adminOnly: true },
};

export function allowedEvents(role) {
    return Object.entries(NOTIFICATION_EVENTS)
        .filter(([, event]) => !event.adminOnly || role === 'admin')
        .map(([value, event]) => ({ value, label: event.label }));
}

export function parseEvents(value) {
    if (Array.isArray(value)) return value;
    try {
        const parsed = JSON.parse(value || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
}

export function wantsEvent(settings, role, event) {
    return Boolean(settings?.enabled) && allowedEvents(role).some((e) => e.value === event)
        && parseEvents(settings.events).includes(event);
}

export function summaryPeriod(frequency, now = new Date()) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
        weekday: 'short', hour: '2-digit', hourCycle: 'h23',
    }).formatToParts(now).map((p) => [p.type, p.value]));
    if (Number(parts.hour) < 17 || ['Sat', 'Sun'].includes(parts.weekday)) return null;
    if (frequency === 'weekly' && parts.weekday !== 'Fri') return null;
    if (!['daily', 'weekly'].includes(frequency)) return null;
    return `${frequency}:${parts.year}-${parts.month}-${parts.day}`;
}

export async function publishNtfy({ serverUrl, token, topic, title, message, click }, fetchImpl = fetch) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetchImpl(serverUrl.replace(/\/$/, ''), {
        method: 'POST', headers,
        body: JSON.stringify({ topic, title, message, ...(click ? { click } : {}) }),
        signal: AbortSignal.timeout(10000), redirect: 'error',
    });
    await response.body?.cancel();
    if (!response.ok) {
        const error = new Error(`ntfy returned HTTP ${response.status}`);
        const retryAfter = response.headers?.get('Retry-After');
        const seconds = retryAfter ? Number(retryAfter) : NaN;
        error.retryAfterMs = Number.isFinite(seconds) ? Math.max(0, seconds * 1000)
            : retryAfter && Number.isFinite(Date.parse(retryAfter)) ? Math.max(0, Date.parse(retryAfter) - Date.now())
            : response.status === 429 ? 3600000 : 0;
        throw error;
    }
}
