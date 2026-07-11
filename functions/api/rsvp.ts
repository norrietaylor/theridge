// POST /api/rsvp — event RSVP form.
// See functions/api/_shared.ts for how to enable email delivery with secrets.
import {
  parseBody,
  isBot,
  verifyTurnstile,
  sendEmail,
  summarize,
  thanks,
  notConfigured,
  json,
  handleOptions,
} from './_shared';
import type { PagesFunction, Env } from './_shared';

export const onRequestOptions: PagesFunction<Env> = () => handleOptions();

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const data = await parseBody(request);

  // 1. Honeypot — silently thank bots.
  if (isBot(data)) return thanks();

  // 2. Optional Turnstile check.
  const check = await verifyTurnstile(env, data, request);
  if (!check.ok) return json({ ok: false, reason: 'failed-verification' }, 400);

  // 3. Compose and send.
  const name = (data.name || '').trim() || 'A neighbour';
  const event = (data.event || '').trim() || 'an event';
  const text = summarize(data, {
    name: 'Name',
    email: 'Email',
    event: 'Event',
    guests: 'Guests',
    note: 'Note',
    source: 'Sent from',
  });

  const result = await sendEmail(env, {
    subject: `The Ridge — RSVP for ${event}: ${name}`,
    text: text || 'An RSVP was submitted with no details.',
    replyTo: data.email,
  });

  if (!result.configured) return notConfigured();
  if (!result.ok) return json({ ok: false, reason: 'send-failed' }, 502);
  return thanks('You’re on the list — see you there! Watch your inbox for any updates.');
};
