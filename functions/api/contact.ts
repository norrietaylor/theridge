// POST /api/contact — general "get in touch" form.
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

// CORS pre-flight (harmless for same-origin posts, needed if a tool posts here).
export const onRequestOptions: PagesFunction<Env> = () => handleOptions();

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const data = await parseBody(request);

  // 1. Honeypot — pretend success so bots don't retry or learn anything.
  if (isBot(data)) return thanks();

  // 2. Optional spam check (only runs when TURNSTILE_SECRET_KEY is set).
  const check = await verifyTurnstile(env, data, request);
  if (!check.ok) return json({ ok: false, reason: 'failed-verification' }, 400);

  // 3. Compose a readable email and send it.
  const name = (data.name || '').trim() || 'A neighbour';
  const text = summarize(data, {
    name: 'Name',
    email: 'Email',
    subject: 'Subject',
    message: 'Message',
    source: 'Sent from',
  });

  const result = await sendEmail(env, {
    subject: `The Ridge — message from ${name}`,
    text: text || 'A contact form was submitted with no details.',
    replyTo: data.email,
  });

  if (!result.configured) return notConfigured(); // secrets not set → mailto fallback
  if (!result.ok) return json({ ok: false, reason: 'send-failed' }, 502);
  return thanks('Thanks for reaching out — we’ll get back to you soon.');
};
