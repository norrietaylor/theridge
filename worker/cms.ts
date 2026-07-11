/**
 * CMS editor operations orchestrator (`/cms/*`).
 *
 * Every route is gated by Cloudflare Access identity (`verifyAccess`). Routes
 * that touch git return 503 when the GitHub App isn't configured. Content is
 * read/written as Markdown with YAML frontmatter through the GitHub Contents
 * API; binaries live in R2 (see `./media`). Commits are stamped with the
 * signed-in editor as author; the committer is the bot (see `./github`).
 *
 * The frontmatter serializer/parser below is deliberately minimal: it targets
 * the closed content schema in `src/content.config.ts` only — scalars
 * (string / YYYY-MM-DD date / number / bool) plus a single string list
 * (`whatYouCanDo`). It round-trips the hand-written files under
 * `src/content/**` without pulling in a YAML dependency.
 */

import type { Env } from './types';
import { verifyAccess } from './access';
import { getInstallationToken, getFile, listDir, putFile, deleteFile } from './github';
import {
  uploadToMedia,
  listPending,
  getPendingImage,
  promotePendingToMedia,
  deletePending,
  validateImage,
} from './media';

const COLLECTIONS = ['events', 'news', 'positions', 'groups', 'meetings', 'gallery'];
const MEDIA_PREFIXES = ['news', 'events', 'gallery'];

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

/** Is the GitHub App git backend configured? */
function ghConfigured(env: Env): boolean {
  return !!(
    env.GH_APP_ID &&
    env.GH_APP_INSTALLATION_ID &&
    env.GH_APP_PRIVATE_KEY &&
    env.GH_OWNER &&
    env.GH_REPO
  );
}

/** lowercase, hyphenated, alphanumerics only — used for new-item filenames. */
function slugify(input: unknown): string {
  return String(input)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ---------------------------------------------------------------------------
// Frontmatter: parse + serialize (closed schema only)
// ---------------------------------------------------------------------------

type FmValue = string | number | boolean | string[];
type FmData = Record<string, FmValue>;

function unescapeDouble(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && i + 1 < s.length) {
      const n = s[i + 1];
      if (n === '"') { out += '"'; i++; continue; }
      if (n === '\\') { out += '\\'; i++; continue; }
      if (n === 'n') { out += '\n'; i++; continue; }
      if (n === 't') { out += '\t'; i++; continue; }
      out += n; i++; continue;
    }
    out += s[i];
  }
  return out;
}

/** Parse a single scalar value: strip quotes, coerce bool/number, else string. */
function parseScalar(raw: string): string | number | boolean {
  const s = raw.trim();
  if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') {
    return unescapeDouble(s.slice(1, -1));
  }
  if (s.length >= 2 && s[0] === "'" && s[s.length - 1] === "'") {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  if (s === 'true') return true;
  if (s === 'false') return false;
  // Numbers only — dates (YYYY-MM-DD) contain hyphens and stay strings.
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}

/**
 * Split a Markdown document into its frontmatter data object and body.
 * Frontmatter is the block between the first two `---` fences.
 */
function parseFrontmatter(text: string): { data: FmData; body: string } {
  const data: FmData = {};
  const normalized = text.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    return { data, body: text };
  }

  const lines = normalized.split('\n');
  const fmLines: string[] = [];
  let i = 1;
  let closed = false;
  for (; i < lines.length; i++) {
    if (lines[i] === '---') { closed = true; i++; break; }
    fmLines.push(lines[i]);
  }
  if (!closed) return { data: {}, body: text };

  let currentListKey: string | null = null;
  for (const line of fmLines) {
    if (line.trim() === '') continue;

    const listItem = /^\s+-\s+(.*)$/.exec(line);
    if (listItem && currentListKey) {
      (data[currentListKey] as string[]).push(String(parseScalar(listItem[1])));
      continue;
    }

    const kv = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (kv) {
      const key = kv[1];
      const raw = kv[2];
      if (raw === '') {
        // Empty value → start of a block list (our only list is whatYouCanDo).
        data[key] = [];
        currentListKey = key;
      } else {
        data[key] = parseScalar(raw);
        currentListKey = null;
      }
    }
  }

  const body = lines.slice(i).join('\n').replace(/^\n+/, '').replace(/\s+$/, '');
  return { data, body };
}

function needsQuote(s: string): boolean {
  return (
    s === '' ||
    /^\s|\s$/.test(s) || // leading/trailing whitespace
    /[:#[\]{}",'`\n]/.test(s) || // YAML special chars anywhere
    /^[-?!&*|>%@]/.test(s) || // leading YAML indicator (block scalar, tag, anchor…)
    /^(true|false|null|yes|no|on|off|~)$/i.test(s) || // bool/null look-alikes
    /^-?\d+(\.\d+)?$/.test(s) // number look-alikes → keep as string
  );
}

/** Serialize one scalar: dates unquoted, strings quoted only when required. */
function serializeScalar(v: FmValue): string {
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  const s = String(v);
  const dm = /^(\d{4}-\d{2}-\d{2})(?:[T ][\d:.+Z-]*)?$/.exec(s);
  if (dm) return dm[1];
  if (needsQuote(s)) {
    return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';
  }
  return s;
}

/** Build a `---\n<frontmatter>\n---\n<body>` Markdown document. */
function serializeFrontmatter(data: FmData, body: string): string {
  const lines: string[] = [];
  let sawDraft = false;

  for (const [key, value] of Object.entries(data)) {
    if (key === 'draft') sawDraft = true;

    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      lines.push(`${key}:`);
      for (const item of value) lines.push(`  - ${serializeScalar(item)}`);
      continue;
    }

    // Omit empty optionals; false / 0 are real values and kept.
    if (value === undefined || value === null || value === '') continue;
    lines.push(`${key}: ${serializeScalar(value)}`);
  }

  if (!sawDraft) lines.push('draft: false');

  const fm = lines.join('\n') + '\n';
  const trimmedBody = (body || '').replace(/^\n+/, '').replace(/\s+$/, '');
  let out = '---\n' + fm + '---\n';
  if (trimmedBody) out += '\n' + trimmedBody + '\n';
  return out;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export async function handleCms(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean); // e.g. ['cms','item','events','x']

  // Gate 1: identity. Access is edge-enforced too; this is defence in depth.
  const identity = await verifyAccess(request, env);
  if (!identity) {
    if (!env.CF_ACCESS_AUD || !env.CF_ACCESS_TEAM_DOMAIN) {
      return json({ error: 'not-configured' }, 503);
    }
    return json({ error: 'unauthorized' }, 401);
  }

  const method = request.method;
  const authorName = identity.name || identity.email;
  const authorEmail = identity.email;
  const sub = parts.slice(1); // segments after 'cms'

  try {
    // GET /cms/me
    if (sub.length === 1 && sub[0] === 'me') {
      if (method !== 'GET') return json({ error: 'method-not-allowed' }, 405);
      return json({ email: identity.email });
    }

    // GET /cms/collections/:type
    if (sub.length === 2 && sub[0] === 'collections') {
      if (method !== 'GET') return json({ error: 'method-not-allowed' }, 405);
      const type = sub[1];
      if (!COLLECTIONS.includes(type)) return json({ error: 'not-found' }, 404);
      if (!ghConfigured(env)) return json({ error: 'not-configured' }, 503);

      const token = await getInstallationToken(env);
      const entries = await listDir(env, token, `src/content/${type}`);
      const items: Array<{ id: string; title: string; draft: boolean; path: string }> = [];
      for (const e of entries) {
        if (e.type !== 'file' || !e.name.endsWith('.md')) continue;
        const id = e.name.replace(/\.md$/, '');
        const file = await getFile(env, token, e.path);
        let title = id;
        let draft = false;
        if (file) {
          const { data } = parseFrontmatter(file.content);
          title = String(data.title ?? data.name ?? data.caption ?? id);
          draft = data.draft === true;
        }
        items.push({ id, title, draft, path: e.path });
      }
      return json({ items });
    }

    // /cms/item/:type/:id  (GET | PUT | DELETE)
    if (sub.length === 3 && sub[0] === 'item') {
      const type = sub[1];
      if (!COLLECTIONS.includes(type)) return json({ error: 'not-found' }, 404);
      const id = slugify(decodeURIComponent(sub[2]));
      if (!id) return json({ error: 'bad-id' }, 400);
      if (!ghConfigured(env)) return json({ error: 'not-configured' }, 503);

      const token = await getInstallationToken(env);
      const path = `src/content/${type}/${id}.md`;

      if (method === 'GET') {
        const file = await getFile(env, token, path);
        if (!file) return json({ error: 'not-found' }, 404);
        const { data, body } = parseFrontmatter(file.content);
        return json({ data, body, sha: file.sha });
      }

      if (method === 'PUT') {
        const payload = (await request.json().catch(() => ({}))) as {
          data?: FmData;
          body?: string;
          sha?: string;
        };
        const data = (payload.data || {}) as FmData;
        const body = typeof payload.body === 'string' ? payload.body : '';
        const content = serializeFrontmatter(data, body);
        const res = await putFile(env, token, {
          path,
          content,
          message: `cms: update ${type}/${id} (via ${authorEmail})`,
          sha: payload.sha,
          authorName,
          authorEmail,
        });
        return json({ ok: true, sha: res.contentSha });
      }

      if (method === 'DELETE') {
        const payload = (await request.json().catch(() => ({}))) as { sha?: string };
        if (!payload.sha) return json({ error: 'sha-required' }, 400);
        await deleteFile(env, token, {
          path,
          sha: payload.sha,
          message: `cms: delete ${type}/${id} (via ${authorEmail})`,
          authorName,
          authorEmail,
        });
        return json({ ok: true });
      }

      return json({ error: 'method-not-allowed' }, 405);
    }

    // POST /cms/media?prefix=news|events|gallery
    if (sub.length === 1 && sub[0] === 'media') {
      if (method !== 'POST') return json({ error: 'method-not-allowed' }, 405);
      const prefix = url.searchParams.get('prefix') || '';
      if (!MEDIA_PREFIXES.includes(prefix)) return json({ error: 'bad-prefix' }, 400);

      const form = await request.formData();
      const file = form.get('file');
      if (!file || typeof file === 'string') return json({ error: 'file-required' }, 400);

      const bytes = await file.arrayBuffer();
      const contentType = file.type || 'application/octet-stream';
      const check = validateImage(bytes, contentType);
      if (!check.ok) return json({ error: check.reason }, 400);

      const { url: mediaUrl } = await uploadToMedia(
        env,
        prefix as 'news' | 'events' | 'gallery',
        bytes,
        contentType,
      );
      return json({ url: mediaUrl });
    }

    // GET /cms/moderation
    if (sub.length === 1 && sub[0] === 'moderation') {
      if (method !== 'GET') return json({ error: 'method-not-allowed' }, 405);
      return json({ items: await listPending(env) });
    }

    // GET /cms/moderation/thumb/:id
    if (sub.length === 3 && sub[0] === 'moderation' && sub[1] === 'thumb') {
      if (method !== 'GET') return json({ error: 'method-not-allowed' }, 405);
      const id = slugify(decodeURIComponent(sub[2]));
      if (!id) return json({ error: 'not-found' }, 404);
      return getPendingImage(env, id);
    }

    // POST /cms/moderation/:id/approve | /cms/moderation/:id/reject
    if (sub.length === 3 && sub[0] === 'moderation') {
      if (method !== 'POST') return json({ error: 'method-not-allowed' }, 405);
      const id = slugify(decodeURIComponent(sub[1]));
      const action = sub[2];
      if (!id) return json({ error: 'not-found' }, 404);

      if (action === 'reject') {
        await deletePending(env, id);
        return json({ ok: true });
      }

      if (action === 'approve') {
        if (!ghConfigured(env)) return json({ error: 'not-configured' }, 503);
        const payload = (await request.json().catch(() => ({}))) as {
          caption?: string;
          credit?: string;
          alt?: string;
          date?: string;
        };

        // Acquire the git token before promoting, so a GitHub failure can't
        // orphan the media (pending pair is deleted by promote).
        const token = await getInstallationToken(env);
        const { mediaUrl, meta } = await promotePendingToMedia(env, id);

        const today = new Date().toISOString().slice(0, 10);
        const data: FmData = {
          image: mediaUrl,
          caption: payload.caption ?? meta.caption ?? '',
          credit: payload.credit ?? meta.credit ?? '',
          date: payload.date || today,
          alt: payload.alt ?? '',
          order: 50,
          draft: false,
        };
        const content = serializeFrontmatter(data, '');
        await putFile(env, token, {
          path: `src/content/gallery/${id}.md`,
          content,
          message: `cms: approve photo ${id} (via ${authorEmail})`,
          authorName,
          authorEmail,
        });
        return json({ ok: true });
      }

      return json({ error: 'not-found' }, 404);
    }

    return json({ error: 'not-found' }, 404);
  } catch {
    return json({ error: 'server-error' }, 500);
  }
}
