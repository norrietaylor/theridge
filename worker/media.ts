/**
 * R2 media for The Ridge CMS.
 *
 * Two responsibilities, both R2-only (no GitHub imports):
 *   1. Serving published media (`/media/*`, public) and editor uploads
 *      (`uploadToMedia`, called from the Access-gated CMS orchestrator).
 *   2. The public resident photo submission flow (`/api/photo-submit`) and its
 *      moderation queue (create / list / thumb / promote / delete pending).
 *
 * Storage model (R2 key === URL path minus the leading slash):
 *   - Published:  media/<news|events|gallery>/<uuid>.<ext>  → served at /media/*
 *   - Pending:    pending/<id>.<ext>  + sidecar  pending/<id>.json
 *     Pending objects are NEVER served under /media/* (serveMedia only allows
 *     keys under media/). They are reachable only through the authed CMS route
 *     /cms/moderation/thumb/:id, which calls getPendingImage.
 *
 * Security: uploads are validated by BOTH magic bytes AND declared
 * content-type (jpeg/png/webp only) plus a 12 MB cap, and validation runs
 * inside createPending/uploadToMedia so it cannot be bypassed by a caller.
 */

import type { Env, R2Object } from './types';
import { verifyTurnstile } from './turnstile';

const MAX_BYTES = 12 * 1024 * 1024; // 12 MB

// Canonical content-type → extension. Both maps are trusted constants; only
// values that survive magic-byte sniffing are ever looked up in them.
const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
const TYPE_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export interface PendingMeta {
  id: string;
  ext: string;
  contentType: string;
  caption?: string;
  credit?: string;
  submitterName?: string;
  submitterEmail?: string;
  submittedAt: string;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function notFound(): Response {
  return new Response('Not Found', { status: 404 });
}

/** Trimmed string value for a form field (files/absent → ''). */
function field(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * Constrain an id taken from a URL to a safe, single-segment token so it can
 * never be used to reach objects outside its own pending/<id>.* pair.
 */
function safeId(id: string): string | null {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id) ? id : null;
}

/** Detect the image type from magic bytes, or null if not a supported image. */
function sniffImageType(bytes: ArrayBuffer): string | null {
  const b = new Uint8Array(bytes);
  // JPEG: FF D8 FF
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return 'image/jpeg';
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    b.length >= 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) {
    return 'image/png';
  }
  // WEBP: "RIFF" .... "WEBP"
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

/**
 * Validate an uploaded image. Rejects unless the raw bytes sniff as one of the
 * three allowed formats AND the declared content-type matches that same format,
 * within the 12 MB cap. Returns the canonical extension on success.
 */
export function validateImage(
  bytes: ArrayBuffer,
  contentType: string,
): { ok: true; ext: string } | { ok: false; reason: string } {
  if (!bytes || bytes.byteLength === 0) return { ok: false, reason: 'empty' };
  if (bytes.byteLength > MAX_BYTES) return { ok: false, reason: 'too-large' };

  const detected = sniffImageType(bytes);
  if (!detected) return { ok: false, reason: 'unsupported-type' };

  const declared = (contentType || '').toLowerCase().split(';')[0].trim();
  if (declared !== detected) return { ok: false, reason: 'type-mismatch' };

  return { ok: true, ext: EXT_BY_TYPE[detected] };
}

function mediaHeaders(object: R2Object): Headers {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  if (object.httpMetadata?.contentType) {
    headers.set('Content-Type', object.httpMetadata.contentType);
  }
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('ETag', object.httpEtag);
  headers.set('X-Content-Type-Options', 'nosniff');
  return headers;
}

/**
 * Public GET/HEAD for published media. Only keys under `media/` are served;
 * anything else (including `pending/`) 404s, so pending objects are never
 * publicly reachable. Path-traversal via encoded `..` is rejected.
 */
export async function serveMedia(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: { Allow: 'GET, HEAD' },
    });
  }

  const url = new URL(request.url);
  let key: string;
  try {
    key = decodeURIComponent(url.pathname.slice(1));
  } catch {
    return notFound();
  }
  if (!key.startsWith('media/') || key.includes('..')) return notFound();
  if (!env.MEDIA) return notFound();

  if (request.method === 'HEAD') {
    const object = await env.MEDIA.head(key);
    if (!object) return notFound();
    const headers = mediaHeaders(object);
    const inm = request.headers.get('If-None-Match');
    if (inm && inm === object.httpEtag) return new Response(null, { status: 304, headers });
    return new Response(null, { status: 200, headers });
  }

  const object = await env.MEDIA.get(key);
  if (!object) return notFound();
  const headers = mediaHeaders(object);
  const inm = request.headers.get('If-None-Match');
  if (inm && inm === object.httpEtag) return new Response(null, { status: 304, headers });
  return new Response(object.body, { status: 200, headers });
}

/**
 * Store an editor upload. Re-validates the bytes so an invalid image can never
 * be written regardless of the caller. Returns the R2 key and its public URL.
 */
export async function uploadToMedia(
  env: Env,
  prefix: 'news' | 'events' | 'gallery',
  bytes: ArrayBuffer,
  contentType: string,
): Promise<{ key: string; url: string }> {
  const v = validateImage(bytes, contentType);
  if (!v.ok) throw new Error(`invalid-image:${v.reason}`);
  const id = crypto.randomUUID();
  const key = `media/${prefix}/${id}.${v.ext}`;
  await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: TYPE_BY_EXT[v.ext] } });
  return { key, url: '/' + key };
}

/** Read and parse a pending sidecar, or null if missing/corrupt. */
async function readPendingMeta(env: Env, id: string): Promise<PendingMeta | null> {
  const obj = await env.MEDIA.get(`pending/${id}.json`);
  if (!obj) return null;
  try {
    const meta = JSON.parse(await obj.text()) as PendingMeta;
    return meta && meta.id ? meta : null;
  } catch {
    return null;
  }
}

/**
 * Store a resident submission as a pending image + sidecar JSON. Validates the
 * bytes (defence in depth) and throws on an invalid image.
 */
export async function createPending(
  env: Env,
  args: {
    bytes: ArrayBuffer;
    contentType: string;
    caption?: string;
    credit?: string;
    submitterName?: string;
    submitterEmail?: string;
  },
): Promise<{ id: string }> {
  const v = validateImage(args.bytes, args.contentType);
  if (!v.ok) throw new Error(`invalid-image:${v.reason}`);
  const id = crypto.randomUUID();
  const contentType = TYPE_BY_EXT[v.ext];
  const meta: PendingMeta = {
    id,
    ext: v.ext,
    contentType,
    caption: args.caption || undefined,
    credit: args.credit || undefined,
    submitterName: args.submitterName || undefined,
    submitterEmail: args.submitterEmail || undefined,
    submittedAt: new Date().toISOString(),
  };
  await env.MEDIA.put(`pending/${id}.${v.ext}`, args.bytes, {
    httpMetadata: { contentType },
  });
  await env.MEDIA.put(`pending/${id}.json`, JSON.stringify(meta), {
    httpMetadata: { contentType: 'application/json' },
  });
  return { id };
}

/** List all pending submissions (oldest first) with an authed thumbnail URL. */
export async function listPending(
  env: Env,
): Promise<Array<PendingMeta & { thumbUrl: string }>> {
  const out: Array<PendingMeta & { thumbUrl: string }> = [];
  let cursor: string | undefined;
  do {
    const listed = await env.MEDIA.list({ prefix: 'pending/', cursor, limit: 1000 });
    for (const obj of listed.objects) {
      if (!obj.key.endsWith('.json')) continue;
      const body = await env.MEDIA.get(obj.key);
      if (!body) continue;
      let meta: PendingMeta;
      try {
        meta = JSON.parse(await body.text()) as PendingMeta;
      } catch {
        continue;
      }
      if (!meta || !meta.id) continue;
      out.push({ ...meta, thumbUrl: `/cms/moderation/thumb/${meta.id}` });
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  out.sort((a, b) => (a.submittedAt < b.submittedAt ? -1 : a.submittedAt > b.submittedAt ? 1 : 0));
  return out;
}

/**
 * Serve a pending image for moderation. Called only from the Access-gated CMS
 * route; never cached by shared caches. 404 if the id is unsafe or missing.
 */
export async function getPendingImage(env: Env, id: string): Promise<Response> {
  const safe = safeId(id);
  if (!safe) return notFound();
  const meta = await readPendingMeta(env, safe);
  if (!meta) return notFound();
  const object = await env.MEDIA.get(`pending/${safe}.${meta.ext}`);
  if (!object) return notFound();
  const headers = new Headers();
  headers.set('Content-Type', meta.contentType || 'application/octet-stream');
  headers.set('Cache-Control', 'no-store, private');
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(object.body, { status: 200, headers });
}

/**
 * Approve a pending submission: copy the image to media/gallery/<id>.<ext>,
 * delete the pending pair, and return the public media URL plus its metadata.
 */
export async function promotePendingToMedia(
  env: Env,
  id: string,
): Promise<{ mediaUrl: string; meta: PendingMeta }> {
  const safe = safeId(id);
  if (!safe) throw new Error('not-found');
  const meta = await readPendingMeta(env, safe);
  if (!meta) throw new Error('not-found');
  const imageKey = `pending/${safe}.${meta.ext}`;
  const object = await env.MEDIA.get(imageKey);
  if (!object) throw new Error('not-found');
  const bytes = await object.arrayBuffer();
  const contentType = TYPE_BY_EXT[meta.ext] || meta.contentType || 'application/octet-stream';
  const mediaKey = `media/gallery/${safe}.${meta.ext}`;
  await env.MEDIA.put(mediaKey, bytes, { httpMetadata: { contentType } });
  await env.MEDIA.delete([imageKey, `pending/${safe}.json`]);
  return { mediaUrl: '/' + mediaKey, meta };
}

/** Reject a pending submission: delete its image + sidecar. */
export async function deletePending(env: Env, id: string): Promise<void> {
  const safe = safeId(id);
  if (!safe) return;
  const meta = await readPendingMeta(env, safe);
  const keys = [`pending/${safe}.json`];
  if (meta && meta.ext) {
    keys.push(`pending/${safe}.${meta.ext}`);
  } else {
    // Sidecar gone/corrupt: sweep any remaining pending/<id>.* objects.
    const listed = await env.MEDIA.list({ prefix: `pending/${safe}.` });
    for (const o of listed.objects) keys.push(o.key);
  }
  await env.MEDIA.delete([...new Set(keys)]);
}

/**
 * Public POST /api/photo-submit. Enforces the honeypot (silent success) and
 * Turnstile, validates the image, and queues it for moderation.
 */
export async function handlePhotoSubmit(request: Request, env: Env): Promise<Response> {
  const type = request.headers.get('content-type') || '';
  if (!type.includes('multipart/form-data')) {
    return json({ ok: false, reason: 'bad-request' }, 400);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, reason: 'bad-request' }, 400);
  }

  // Honeypot: bots fill the hidden `company` field → pretend success, store nothing.
  if (field(form, 'company')) return json({ ok: true });

  const passed = await verifyTurnstile(
    env.TURNSTILE_SECRET_KEY,
    field(form, 'cf-turnstile-response'),
    request.headers.get('CF-Connecting-IP'),
  );
  if (!passed) return json({ ok: false, reason: 'captcha' }, 400);

  if (!env.MEDIA) return json({ ok: false, reason: 'not-configured' }, 503);

  const photo = form.get('photo');
  if (!photo || typeof photo === 'string') {
    return json({ ok: false, reason: 'no-file' }, 400);
  }
  const bytes = await photo.arrayBuffer();
  const v = validateImage(bytes, photo.type || '');
  if (!v.ok) return json({ ok: false, reason: v.reason }, 400);

  await createPending(env, {
    bytes,
    contentType: photo.type || '',
    caption: field(form, 'caption'),
    credit: field(form, 'credit'),
    submitterName: field(form, 'name'),
    submitterEmail: field(form, 'email'),
  });
  return json({ ok: true });
}
