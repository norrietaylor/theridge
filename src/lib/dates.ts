// Shared date helpers so every page formats dates the same way.
// Dates in content are authored as plain calendar dates/times in local time.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function monthAbbr(d: Date): string {
  return MONTHS[d.getUTCMonth()];
}

export function dayNum(d: Date): number {
  return d.getUTCDate();
}

/** e.g. "Saturday, July 18, 2026" */
export function formatLong(d: Date): string {
  return `${DAYS[d.getUTCDay()]}, ${MONTHS_LONG[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/** e.g. "Jul 18, 2026" */
export function formatShort(d: Date): string {
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/** e.g. "July 2026" — used to group events by month */
export function monthYear(d: Date): string {
  return `${MONTHS_LONG[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Whether a date is today or in the future (compared by calendar day, UTC). */
export function isUpcoming(d: Date, now = new Date()): boolean {
  const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return day >= today;
}
