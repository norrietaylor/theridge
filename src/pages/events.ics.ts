import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { SITE } from '../consts';

// A fixed timestamp keeps the generated feed byte-for-byte reproducible across
// builds (no Date.now()/new Date() churn). It only marks when the entry data was
// produced, so a constant is perfectly valid for a static publish feed.
const DTSTAMP = '20260101T000000Z';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Format a date as an all-day YYYYMMDD value in UTC (dates are authored as plain calendar days). */
function ymd(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

/** Return a new date shifted by `days`, in UTC. */
function addDays(d: Date, days: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + days));
}

/** Escape reserved characters in ICS text values (RFC 5545 §3.3.11). */
function esc(value: string): string {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

export const GET: APIRoute = async () => {
  // Only confirmed events belong in a calendar people subscribe to — leave out
  // drafts and suggested/example events.
  const events = (await getCollection('events', ({ data }) => !data.draft && !data.example)).sort(
    (a, b) => a.data.start.getTime() - b.data.start.getTime(),
  );

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//The Ridge//Community Events//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(`${SITE.name} — Events`)}`,
  ];

  for (const entry of events) {
    const { title, start, end, location, summary, time } = entry.data;
    // DTEND is exclusive for all-day events, so the day after the final day.
    const dtStart = ymd(start);
    const dtEnd = ymd(addDays(end ?? start, 1));
    const description = time ? `${time} — ${summary}` : summary;

    lines.push(
      'BEGIN:VEVENT',
      `UID:${entry.id}@ourridge.ca`,
      `DTSTAMP:${DTSTAMP}`,
      `DTSTART;VALUE=DATE:${dtStart}`,
      `DTEND;VALUE=DATE:${dtEnd}`,
      `SUMMARY:${esc(title)}`,
    );
    if (location) lines.push(`LOCATION:${esc(location)}`);
    lines.push(`DESCRIPTION:${esc(description)}`);
    lines.push(`URL:${SITE.url}/events/${entry.id}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');

  // ICS requires CRLF line endings.
  const body = lines.join('\r\n') + '\r\n';

  return new Response(body, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="the-ridge-events.ics"',
    },
  });
};
