const SGT = 'Asia/Singapore';
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

/** Calendar date in Asia/Singapore. Fixes MySQL DATE values that arrive as 16:00Z the day before. */
export function toCalendarDate(d) {
    if (d == null || d === '') return '';
    if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.trim())) return d.trim();
    const date = d instanceof Date ? d : new Date(d);
    if (Number.isNaN(date.getTime())) return String(d).split('T')[0];
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: SGT,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(date);
}

function closestExpiry(validDates, targetDate) {
    if (!targetDate) return null;
    if (validDates.includes(targetDate)) return targetDate;
    const target = new Date(targetDate).getTime();
    if (Number.isNaN(target)) return null;
    let closest = null;
    let minDiff = Infinity;
    for (const d of validDates) {
        const t = new Date(d).getTime();
        if (Number.isNaN(t)) continue;
        const diff = Math.abs(t - target);
        if (diff < minDiff && diff <= THREE_DAYS_MS) {
            minDiff = diff;
            closest = d;
        }
    }
    return closest;
}

/** Listed expiry within 3 days, otherwise still try the stored calendar date on the chain. */
export function resolveExpiryCandidates(rawDate, validDates = []) {
    const calendar = toCalendarDate(rawDate);
    const listed = closestExpiry(validDates, calendar);
    if (listed) return [listed];
    return calendar ? [calendar] : [];
}
