/**
 * GitHub App git client for the CMS.
 *
 * Content metadata (markdown in src/content/**) lives in git; this module is
 * how the Worker reads and writes it via the GitHub Contents API. It
 * authenticates as a GitHub App: a short-lived RS256 App JWT (signed with Web
 * Crypto over the PKCS8 PEM in GH_APP_PRIVATE_KEY) is exchanged for an
 * installation access token, which is cached in module scope until ~1 minute
 * before it expires.
 *
 * Commits are stamped with two identities: the committer is always the bot
 * ("The Ridge CMS"), and the author is the signed-in editor, so history shows
 * who actually made each change.
 *
 * Required env (see docs/cms-setup.md):
 *   GH_APP_ID               GitHub App ID (JWT issuer)
 *   GH_APP_INSTALLATION_ID  installation on the target repo
 *   GH_APP_PRIVATE_KEY      PKCS8 PEM private key (secret)
 *   GH_OWNER / GH_REPO / GH_BRANCH   committed repo coordinates
 *
 * Never logs the private key or any token.
 */

import type { Env } from './types';

const GH_API = 'https://api.github.com';
const GH_ACCEPT = 'application/vnd.github+json';
const GH_USER_AGENT = 'theridge-cms';

// The commit committer is always the bot; the author is the editor (per call).
const COMMITTER = { name: 'The Ridge CMS', email: 'cms@ourridge.ca' };

export interface GhFile {
  path: string;
  content: string;
  sha: string;
}

// ---------------------------------------------------------------------------
// base64 / UTF-8 helpers (Unicode-safe; btoa/atob only speak binary strings)
// ---------------------------------------------------------------------------

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000; // avoid arg-count limits on String.fromCharCode
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64UrlFromBytes(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Encode a UTF-8 string as standard base64 (for git file contents). */
export function utf8ToBase64(text: string): string {
  return bytesToBase64(new TextEncoder().encode(text));
}

/** Decode base64 (as returned by the Contents API, may contain newlines) to UTF-8. */
export function base64ToUtf8(b64: string): string {
  return new TextDecoder().decode(base64ToBytes(b64));
}

// ---------------------------------------------------------------------------
// App JWT + installation token
// ---------------------------------------------------------------------------

/** Strip a PEM header/footer + whitespace and return the raw DER bytes. */
function pemToDer(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
  return base64ToBytes(body);
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  // Web Crypto only imports PKCS#8 ("BEGIN PRIVATE KEY"). GitHub downloads App
  // keys as PKCS#1 ("BEGIN RSA PRIVATE KEY"); give a clear, actionable error
  // instead of an opaque DER failure. Convert once with:
  //   openssl pkcs8 -topk8 -nocrypt -in app.pem -out app.pkcs8.pem
  if (/BEGIN RSA PRIVATE KEY/.test(pem)) {
    throw new Error(
      'GH_APP_PRIVATE_KEY is PKCS#1; convert to PKCS#8 (openssl pkcs8 -topk8 -nocrypt). See docs/cms-setup.md.',
    );
  }
  return crypto.subtle.importKey(
    'pkcs8',
    pemToDer(pem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

/** Build a short-lived (≤10 min) RS256 App JWT. */
async function buildAppJwt(env: Env): Promise<string> {
  const appId = env.GH_APP_ID;
  const pem = env.GH_APP_PRIVATE_KEY;
  if (!appId || !pem) throw new Error('GitHub App credentials not configured');

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = { iat: now - 30, exp: now + 540, iss: appId };

  const encoder = new TextEncoder();
  const signingInput =
    base64UrlFromBytes(encoder.encode(JSON.stringify(header))) +
    '.' +
    base64UrlFromBytes(encoder.encode(JSON.stringify(payload)));

  const key = await importPrivateKey(pem);
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    encoder.encode(signingInput),
  );
  return signingInput + '.' + base64UrlFromBytes(new Uint8Array(signature));
}

interface CachedToken {
  token: string;
  safeUntilMs: number; // real expiry minus ~1 min of headroom
}
let tokenCache: CachedToken | null = null;

/**
 * Return a valid installation access token, minting a new one only when the
 * cached token is missing or about to expire.
 */
export async function getInstallationToken(env: Env): Promise<string> {
  const now = Date.now();
  if (tokenCache && now < tokenCache.safeUntilMs) return tokenCache.token;

  const installationId = env.GH_APP_INSTALLATION_ID;
  if (!installationId) throw new Error('GitHub App installation not configured');

  const jwt = await buildAppJwt(env);
  const res = await fetch(
    `${GH_API}/app/installations/${encodeURIComponent(installationId)}/access_tokens`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: GH_ACCEPT,
        'User-Agent': GH_USER_AGENT,
      },
    },
  );
  if (!res.ok) throw new Error(`GitHub installation token request failed (${res.status})`);

  const data = (await res.json()) as { token: string; expires_at: string };
  const expiresAtMs = Date.parse(data.expires_at);
  const safeUntilMs = Number.isFinite(expiresAtMs) ? expiresAtMs - 60_000 : now + 9 * 60_000;
  tokenCache = { token: data.token, safeUntilMs };
  return data.token;
}

// ---------------------------------------------------------------------------
// Contents API
// ---------------------------------------------------------------------------

function contentsUrl(env: Env, path: string): string {
  // Encode each segment but keep the directory separators.
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return `${GH_API}/repos/${env.GH_OWNER}/${env.GH_REPO}/contents/${encoded}`;
}

function branchRef(env: Env): string {
  return env.GH_BRANCH || 'main';
}

function authHeaders(token: string, extra?: Record<string, string>): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: GH_ACCEPT,
    'User-Agent': GH_USER_AGENT,
    ...extra,
  };
}

/** Fetch a single file. Returns null on 404; throws on other errors. */
export async function getFile(env: Env, token: string, path: string): Promise<GhFile | null> {
  const url = `${contentsUrl(env, path)}?ref=${encodeURIComponent(branchRef(env))}`;
  const res = await fetch(url, { headers: authHeaders(token) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub getFile failed (${res.status})`);

  const data = (await res.json()) as { content?: string; sha: string; path: string };
  return {
    path: data.path,
    content: data.content ? base64ToUtf8(data.content) : '',
    sha: data.sha,
  };
}

/** List a directory's entries. Returns [] for a missing directory. */
export async function listDir(
  env: Env,
  token: string,
  path: string,
): Promise<Array<{ name: string; path: string; type: string; sha: string }>> {
  const url = `${contentsUrl(env, path)}?ref=${encodeURIComponent(branchRef(env))}`;
  const res = await fetch(url, { headers: authHeaders(token) });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`GitHub listDir failed (${res.status})`);

  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) return []; // a file path returns an object, not a listing
  return (data as Array<{ name: string; path: string; type: string; sha: string }>).map((item) => ({
    name: item.name,
    path: item.path,
    type: item.type,
    sha: item.sha,
  }));
}

/**
 * Create or update a file. Pass `sha` to update an existing file; omit it to
 * create a new one. Committer is the bot; author is the editor.
 */
export async function putFile(
  env: Env,
  token: string,
  args: {
    path: string;
    content: string;
    message: string;
    sha?: string;
    authorName: string;
    authorEmail: string;
  },
): Promise<{ commitSha: string; contentSha: string }> {
  const body: Record<string, unknown> = {
    message: args.message,
    content: utf8ToBase64(args.content),
    branch: branchRef(env),
    committer: COMMITTER,
    author: { name: args.authorName, email: args.authorEmail },
  };
  if (args.sha) body.sha = args.sha;

  const res = await fetch(contentsUrl(env, args.path), {
    method: 'PUT',
    headers: authHeaders(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GitHub putFile failed (${res.status})`);

  const data = (await res.json()) as {
    commit: { sha: string };
    content: { sha: string } | null;
  };
  return { commitSha: data.commit.sha, contentSha: data.content ? data.content.sha : '' };
}

/** Delete a file by its blob sha. Committer is the bot; author is the editor. */
export async function deleteFile(
  env: Env,
  token: string,
  args: {
    path: string;
    sha: string;
    message: string;
    authorName: string;
    authorEmail: string;
  },
): Promise<void> {
  const body = {
    message: args.message,
    sha: args.sha,
    branch: branchRef(env),
    committer: COMMITTER,
    author: { name: args.authorName, email: args.authorEmail },
  };
  const res = await fetch(contentsUrl(env, args.path), {
    method: 'DELETE',
    headers: authHeaders(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GitHub deleteFile failed (${res.status})`);
}
