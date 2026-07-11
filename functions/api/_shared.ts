// functions/api/_shared.ts
//
// Shared helpers for The Ridge's Cloudflare Pages Functions — the small
// server-side handlers behind the /contact, /volunteer and /rsvp forms.
//
// These functions are DEFENSIVE by design: the website works perfectly before
// any secrets are configured. When the optional secrets below are present, the
// forms actually send email; when they're absent, each endpoint returns a
// friendly 503 so the front-end can fall back to a plain mailto: link and no
// neighbour ever meets a broken button.
//
// ── Turning the forms ON ──────────────────────────────────────────────
// Set these in the Cloudflare Pages dashboard
// (Settings → Environment variables and secrets). No code change is needed:
//
//   RESEND_API_KEY        (required to send)  — from https://resend.com
//   CONTACT_TO            (required to send)  — the inbox that receives submissions
//   CONTACT_FROM          (optional)          — a VERIFIED Resend sender address,
//                                               e.g. "The Ridge <hello@theridge.dev>"
//   TURNSTILE_SECRET_KEY  (optional)          — enables Cloudflare Turnstile spam
//                                               protection when present
//
// Secrets live ONLY in `env` — never hard-code them in this file.

/** Fallback address shown to neighbours when the forms aren't wired up yet.
 *  Keep this in sync with SITE.email in src/consts.ts. */
export const FALLBACK_EMAIL = 'hello@ourridge.ca';

/** Environment bindings. Every field is optional so the functions never crash
 *  on a fresh deployment — each handler checks what it needs and degrades. */
export interface Env {
  RESEND_API_KEY?: string;
  CONTACT_TO?: string;
  CONTACT_FROM?: string;
  TURNSTILE_SECRET_KEY?: string;
}

/**
 * Minimal local stand-in for Cloudflare's global `PagesFunction` type, so these
 * files type-check even before `@cloudflare/workers-types` is installed.
 * Cloudflare Pages supplies the real (richer) type at build time; this is a
 * compatible subset. Import it in each handler: `import type { PagesFunction }`.
 */
export type PagesFunction<E = Env> = (context: {
  request: Request;
  env: E;
  params: Record<string, string | string[]>;
  waitUntil: (promise: Promise<unknown>) => void;
  next: (input?: Request | string, init?: RequestInit) => Promise<Response>;
  data: Record<string, unknown>;
}) => Response | Promise<Response>;

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/** JSON response with permissive CORS (a form may post from the site or a tool). */
export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS },
  });
}

/** CORS pre-flight handler. Wire up per route as `export const onRequestOptions`. */
export function handleOptions(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/** A deliberately vague success. Also returned to bots so they learn nothing. */
export function thanks(
  message = 'Thanks! Your message is on its way. We’ll be in touch soon.',
): Response {
  return json({ ok: true, message });
}

/** 503 used when the required email secrets aren't set yet. `fallback` tells the
 *  front-end how to guide the neighbour (typically a mailto: link). */
export function notConfigured(): Response {
  return json(
    { ok: false, reason: 'not-configured', fallback: `email ${FALLBACK_EMAIL}` },
    503,
  );
}

/** Read a POST body as a plain string map, accepting JSON, url-encoded, or
 *  multipart form data. Returns {} on any parse error (treated as empty). */
export async function parseBody(request: Request): Promise<Record<string, string>> {
  const contentType = request.headers.get('content-type') || '';
  try {
    if (contentType.includes('application/json')) {
      const raw = (await request.json()) as Record<string, unknown>;
      const out: Record<string, string> = {};
      for (const [key, value] of Object.entries(raw)) {
        out[key] = Array.isArray(value)
          ? value.join(', ')
          : value == null
            ? ''
            : String(value);
      }
      return out;
    }
    // application/x-www-form-urlencoded OR multipart/form-data
    const form = await request.formData();
    const out: Record<string, string> = {};
    for (const [key, value] of form.entries()) {
      out[key] = typeof value === 'string' ? value : '';
    }
    return out;
  } catch {
    return {};
  }
}

/** Honeypot: real people leave the hidden `company` field empty; bots fill it. */
export function isBot(data: Record<string, string>): boolean {
  return Boolean(data.company && data.company.trim());
}

/** Verify a Cloudflare Turnstile token. Skipped (returns ok) when no secret is
 *  configured, so spam protection is strictly opt-in. */
export async function verifyTurnstile(
  env: Env,
  data: Record<string, string>,
  request: Request,
): Promise<{ ok: boolean; skipped?: boolean }> {
  if (!env.TURNSTILE_SECRET_KEY) return { ok: true, skipped: true };

  const token = data['cf-turnstile-response'] || '';
  if (!token) return { ok: false };

  const body = new URLSearchParams();
  body.set('secret', env.TURNSTILE_SECRET_KEY);
  body.set('response', token);
  const ip = request.headers.get('CF-Connecting-IP');
  if (ip) body.set('remoteip', ip);

  try {
    const res = await fetch(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      { method: 'POST', body },
    );
    const out = (await res.json()) as { success?: boolean };
    return { ok: Boolean(out.success) };
  } catch {
    return { ok: false };
  }
}

/** Turn a submission into a plain-text email body. `labels` gives friendly,
 *  ordered names for known fields; anything else non-empty is appended too. */
export function summarize(
  data: Record<string, string>,
  labels: Record<string, string>,
): string {
  const skip = new Set(['company', 'cf-turnstile-response']);
  const lines: string[] = [];

  // Preferred, human-friendly fields first, in the order given…
  for (const [key, label] of Object.entries(labels)) {
    skip.add(key);
    const value = (data[key] || '').trim();
    if (value) lines.push(`${label}: ${value}`);
  }
  // …then any other fields that came along (future-proofing).
  for (const [key, value] of Object.entries(data)) {
    if (skip.has(key)) continue;
    const v = (value || '').trim();
    if (v) lines.push(`${key}: ${v}`);
  }
  return lines.join('\n');
}

/** Send one email via Resend's REST API. Returns `configured: false` when the
 *  required secrets are missing, so the caller can respond with notConfigured(). */
export async function sendEmail(
  env: Env,
  opts: { subject: string; text: string; replyTo?: string },
): Promise<{ configured: boolean; ok: boolean; status?: number }> {
  if (!env.RESEND_API_KEY || !env.CONTACT_TO) {
    return { configured: false, ok: false };
  }

  // `from` must be a sender you've verified in Resend, otherwise delivery fails.
  const from = env.CONTACT_FROM || `The Ridge <${FALLBACK_EMAIL}>`;
  const payload: Record<string, unknown> = {
    from,
    to: [env.CONTACT_TO],
    subject: opts.subject,
    text: opts.text,
  };
  // Reply-To lets you simply hit "reply" and answer the neighbour directly.
  if (opts.replyTo && /.+@.+\..+/.test(opts.replyTo)) {
    payload.reply_to = opts.replyTo;
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    return { configured: true, ok: res.ok, status: res.status };
  } catch {
    return { configured: true, ok: false };
  }
}
