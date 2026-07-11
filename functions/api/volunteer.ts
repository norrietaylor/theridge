// POST /api/volunteer — "I'd like to help" / get-involved form.
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

  // 3. Compose and send. `interests`/`availability` may be lists — parseBody
  //    already flattens arrays into a comma-separated string for us.
  const name = (data.name || '').trim() || 'A neighbour';
  const text = summarize(data, {
    name: 'Name',
    email: 'Email',
    phone: 'Phone',
    street: 'Street',
    interests: 'Interests',
    availability: 'Availability',
    message: 'Note',
    source: 'Sent from',
  });

  const result = await sendEmail(env, {
    subject: `The Ridge — new volunteer: ${name}`,
    text: text || 'A volunteer form was submitted with no details.',
    replyTo: data.email,
  });

  if (!result.configured) return notConfigured();
  if (!result.ok) return json({ ok: false, reason: 'send-failed' }, 502);
  return thanks('Thanks for putting your hand up — a coordinator will be in touch soon.');
};
