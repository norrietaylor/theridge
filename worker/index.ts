/**
 * Cloudflare Worker for The Ridge.
 *
 * Serves the static Astro site via the ASSETS binding and handles a small set
 * of POST endpoints under /api/*:
 *   /api/contact    → emails the group inbox (Resend)
 *   /api/volunteer  → emails the group inbox (Resend)
 *   /api/rsvp       → emails the event coordinator/inbox (Resend)
 *   /api/subscribe  → adds a subscriber to the newsletter (MailerLite)
 *
 * Everything degrades safely: missing secrets → a clear `not-configured`
 * response the front-end turns into an email fallback; a filled honeypot →
 * a silent success; optional Turnstile verification when a secret is set.
 *
 * Required secrets (Cloudflare → Worker → Settings → Variables & Secrets):
 *   RESEND_API_KEY        Resend API key (forms)
 *   CONTACT_TO            where form mail is delivered, e.g. hello@ourridge.ca
 *   MAILERLITE_API_KEY    MailerLite API key (newsletter)
 * Optional:
 *   CONTACT_FROM          verified Resend sender (default below)
 *   TURNSTILE_SECRET_KEY  enables Cloudflare Turnstile spam checks
 *   MAILERLITE_GROUP_ID   target list/group for new subscribers
 */

import type { Env } from './types';
import { verifyTurnstile } from './turnstile';
import { handleCms } from './cms';
import { serveMedia, handlePhotoSubmit } from './media';

type Fields = Record<string, string | string[]>;

const DEFAULT_FROM = 'The Ridge <hello@ourridge.ca>';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

async function parseBody(request: Request): Promise<Fields> {
  const type = request.headers.get('content-type') || '';
  if (type.includes('application/json')) {
    try {
      return (await request.json()) as Fields;
    } catch {
      return {};
    }
  }
  const form = await request.formData();
  const out: Fields = {};
  for (const [key, value] of form.entries()) {
    const v = typeof value === 'string' ? value : '';
    if (key in out) {
      const existing = out[key];
      out[key] = Array.isArray(existing) ? [...existing, v] : [existing as string, v];
    } else {
      out[key] = v;
    }
  }
  return out;
}

function str(fields: Fields, key: string): string {
  const v = fields[key];
  return (Array.isArray(v) ? v.join(', ') : v || '').toString().trim();
}

async function sendEmail(
  env: Env,
  opts: { subject: string; text: string; replyTo?: string },
): Promise<{ ok: boolean; reason?: string }> {
  if (!env.RESEND_API_KEY || !env.CONTACT_TO) return { ok: false, reason: 'not-configured' };
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.CONTACT_FROM || DEFAULT_FROM,
      to: [env.CONTACT_TO],
      subject: opts.subject,
      text: opts.text,
      reply_to: opts.replyTo || undefined,
    }),
  });
  if (!res.ok) return { ok: false, reason: 'send-failed' };
  return { ok: true };
}

/** Turn a submission into an email, respecting honeypot + Turnstile. */
async function handleFormEmail(
  request: Request,
  env: Env,
  build: (f: Fields) => { subject: string; text: string },
): Promise<Response> {
  const fields = await parseBody(request);
  if (str(fields, 'company')) return json({ ok: true }); // honeypot → pretend success
  const passed = await verifyTurnstile(
    env.TURNSTILE_SECRET_KEY,
    str(fields, 'cf-turnstile-response'),
    request.headers.get('CF-Connecting-IP'),
  );
  if (!passed) return json({ ok: false, reason: 'captcha' }, 400);

  const { subject, text } = build(fields);
  const result = await sendEmail(env, { subject, text, replyTo: str(fields, 'email') });
  if (!result.ok) return json(result, result.reason === 'not-configured' ? 503 : 502);
  return json({ ok: true });
}

async function handleSubscribe(request: Request, env: Env): Promise<Response> {
  const fields = await parseBody(request);
  if (str(fields, 'company')) return json({ ok: true }); // honeypot
  const email = str(fields, 'email');
  if (!email) return json({ ok: false, reason: 'email-required' }, 400);
  if (!env.MAILERLITE_API_KEY) return json({ ok: false, reason: 'not-configured' }, 503);

  const name = str(fields, 'name');
  const payload: Record<string, unknown> = { email };
  if (name) payload.fields = { name };
  if (env.MAILERLITE_GROUP_ID) payload.groups = [env.MAILERLITE_GROUP_ID];

  const res = await fetch('https://connect.mailerlite.com/api/subscribers', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.MAILERLITE_API_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });
  // MailerLite returns 200/201 for created/updated; anything else is a failure.
  if (res.status !== 200 && res.status !== 201) {
    return json({ ok: false, reason: 'subscribe-failed' }, 502);
  }
  return json({ ok: true });
}

const CONTACT = (f: Fields) => ({
  subject: `Contact form: ${str(f, 'topic') || 'General'}, The Ridge`,
  text: [
    'New message via ourridge.ca/contact',
    '',
    `Name:  ${str(f, 'name')}`,
    `Email: ${str(f, 'email')}`,
    `About: ${str(f, 'topic') || 'General'}`,
    '',
    'Message:',
    str(f, 'message'),
  ].join('\n'),
});

const VOLUNTEER = (f: Fields) => ({
  subject: 'New sign-up, The Ridge',
  text: [
    'Someone signed up to help out or join (via ourridge.ca/get-involved)',
    '',
    `Name:         ${str(f, 'name')}`,
    `Email:        ${str(f, 'email')}`,
    `Interested in:${str(f, 'interests') ? ' ' + str(f, 'interests') : ' (not specified)'}`,
    `Availability: ${str(f, 'availability') || '(not specified)'}`,
  ].join('\n'),
});

const RSVP = (f: Fields) => ({
  subject: `RSVP: ${str(f, 'event') || 'event'}, The Ridge`,
  text: [
    `RSVP via ourridge.ca for: ${str(f, 'event')}`,
    '',
    `Name:       ${str(f, 'name')}`,
    `Email:      ${str(f, 'email')}`,
    `Party size: ${str(f, 'party') || '1'}`,
    `Note:       ${str(f, 'note') || '(none)'}`,
  ].join('\n'),
});

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CMS gateway (editor operations, Cloudflare Access + JWT gated).
    if (url.pathname === '/cms' || url.pathname.startsWith('/cms/')) {
      return handleCms(request, env);
    }

    // Public media served from R2 (uploaded photos).
    if (url.pathname.startsWith('/media/')) {
      return serveMedia(request, env);
    }

    if (url.pathname.startsWith('/api/')) {
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204 });
      }
      if (request.method !== 'POST') {
        return json({ ok: false, reason: 'method-not-allowed' }, 405);
      }
      try {
        switch (url.pathname) {
          case '/api/contact':
            return await handleFormEmail(request, env, CONTACT);
          case '/api/volunteer':
            return await handleFormEmail(request, env, VOLUNTEER);
          case '/api/rsvp':
            return await handleFormEmail(request, env, RSVP);
          case '/api/subscribe':
            return await handleSubscribe(request, env);
          case '/api/photo-submit':
            return await handlePhotoSubmit(request, env);
          default:
            return json({ ok: false, reason: 'not-found' }, 404);
        }
      } catch {
        return json({ ok: false, reason: 'server-error' }, 500);
      }
    }

    // Everything else is a static asset (or the 404 page).
    return env.ASSETS.fetch(request);
  },
};
