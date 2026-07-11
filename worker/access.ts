/**
 * Cloudflare Access identity verification.
 *
 * Every editor request to /cms/* is gated on a valid Cloudflare Access JWT.
 * `verifyAccess` cryptographically verifies the `Cf-Access-Jwt-Assertion`
 * header (or the `CF_Authorization` cookie) against the team's JWKS and
 * enforces `aud`, `iss`, `exp` and `nbf` before returning an identity.
 *
 * SECURITY-CRITICAL: this function fails closed. A missing, malformed,
 * expired, wrong-audience, wrong-issuer, or improperly-signed token — and any
 * unexpected error along the way — yields `null` (no identity). It never
 * trusts a claim before the RSA signature over that exact token is verified,
 * and it pins the verification algorithm (RS256 / RSASSA-PKCS1-v1_5 / SHA-256)
 * regardless of the `alg` advertised in the token header, so an attacker can
 * never downgrade to `none` or an HMAC "alg confusion" forgery.
 *
 * Configuration comes from the Worker environment:
 *   CF_ACCESS_AUD          the Access application's AUD tag (required)
 *   CF_ACCESS_TEAM_DOMAIN  "<team>" or "<team>.cloudflareaccess.com" (required)
 * If either is unset, verification fails closed.
 */

import type { Env } from './types';

export interface AccessIdentity {
  email: string;
  sub?: string;
  name?: string;
}

/** Cached signing keys per team host: kid -> imported public key. */
interface JwksState {
  keys: Map<string, CryptoKey>;
  fetchedAt: number;
}

/** Module-scope JWKS cache (survives between requests on a warm isolate). */
const jwksByHost: Map<string, JwksState> = new Map();

/** How long a fetched key set is trusted before a refresh (~1h). */
const KEY_TTL_MS = 60 * 60 * 1000;
/** Minimum spacing between JWKS refetches triggered by an unknown kid. */
const MIN_REFETCH_MS = 5 * 60 * 1000;
/** Clock-skew tolerance for exp/nbf, in seconds. */
const LEEWAY_SECONDS = 60;

/**
 * Verify the caller's Cloudflare Access token and return their identity, or
 * `null` if the token is absent, invalid, or the Worker is not configured.
 */
export async function verifyAccess(request: Request, env: Env): Promise<AccessIdentity | null> {
  try {
    const aud = env.CF_ACCESS_AUD;
    const teamDomain = env.CF_ACCESS_TEAM_DOMAIN;
    // Fail closed if the gateway isn't configured — never allow unauthenticated
    // access just because the AUD/team domain are missing.
    if (!aud || !teamDomain) return null;

    const token = readToken(request);
    if (!token) return null;

    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const header = decodeJsonSegment(parts[0]);
    // Pin RS256. We hardcode the verify algorithm below too, but rejecting any
    // other advertised `alg` (e.g. "none", "HS256") is defence in depth.
    if (!header || header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) {
      return null;
    }

    const host = teamHost(teamDomain);
    const key = await getSigningKey(host, header.kid);
    if (!key) return null;

    // Verify the signature over the exact `<header>.<payload>` bytes BEFORE
    // trusting any claim. Algorithm is fixed here (not taken from the header).
    const signingInput = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const signature = base64urlToBytes(parts[2]);
    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      signature,
      signingInput,
    );
    if (!valid) return null;

    const claims = decodeJsonSegment(parts[1]);
    if (!claims || typeof claims !== 'object') return null;

    // Issuer must be exactly this team's Access domain.
    if (claims.iss !== `https://${host}`) return null;

    // Audience must include our Access application's AUD tag.
    const audClaim = claims.aud;
    const audOk = Array.isArray(audClaim) ? audClaim.includes(aud) : audClaim === aud;
    if (!audOk) return null;

    // Expiry / not-before, with a small clock-skew tolerance.
    const now = Math.floor(Date.now() / 1000);
    if (typeof claims.exp !== 'number' || now > claims.exp + LEEWAY_SECONDS) return null;
    if (typeof claims.nbf === 'number' && now < claims.nbf - LEEWAY_SECONDS) return null;

    // Identity. Email is required — without it there is no usable identity.
    const email = typeof claims.email === 'string' ? claims.email.trim() : '';
    if (!email) return null;

    const identity: AccessIdentity = { email };
    if (typeof claims.sub === 'string' && claims.sub) identity.sub = claims.sub;
    const name = readName(claims);
    if (name) identity.name = name;
    return identity;
  } catch {
    // Any unexpected failure (bad base64, JSON, fetch, crypto) fails closed.
    return null;
  }
}

/** Read the Access JWT from the header, falling back to the cookie. */
function readToken(request: Request): string | null {
  const header = request.headers.get('Cf-Access-Jwt-Assertion');
  if (header && header.trim()) return header.trim();

  const cookie = request.headers.get('Cookie');
  if (cookie) {
    for (const part of cookie.split(';')) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      const name = part.slice(0, eq).trim();
      if (name === 'CF_Authorization') {
        const value = part.slice(eq + 1).trim();
        if (value) return value;
      }
    }
  }
  return null;
}

/** Extract a display name from `name` or a nested `custom` claim, if present. */
function readName(claims: any): string | undefined {
  if (typeof claims.name === 'string' && claims.name) return claims.name;
  const custom = claims.custom;
  if (custom && typeof custom === 'object' && typeof custom.name === 'string' && custom.name) {
    return custom.name;
  }
  return undefined;
}

/** Normalise a configured team domain to its full `*.cloudflareaccess.com` host. */
function teamHost(domain: string): string {
  const cleaned = domain
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
  return cleaned.endsWith('.cloudflareaccess.com') ? cleaned : `${cleaned}.cloudflareaccess.com`;
}

/**
 * Return the imported public key for `kid`, fetching (and caching) the team's
 * JWKS as needed. Returns `null` if the key can't be found or fetched.
 */
async function getSigningKey(host: string, kid: string): Promise<CryptoKey | null> {
  const now = Date.now();
  let state = jwksByHost.get(host);

  const expired = !state || now - state.fetchedAt > KEY_TTL_MS;
  const missingKid = !!state && !state.keys.has(kid);
  const mayRefetchForMiss = !state || now - state.fetchedAt > MIN_REFETCH_MS;

  // Refresh when the cache is cold/stale, or when an unknown kid appears and we
  // haven't refetched too recently (handles key rotation without hammering the
  // certs endpoint on bogus kids).
  if (expired || (missingKid && mayRefetchForMiss)) {
    const fetched = await fetchJwks(host);
    if (fetched) {
      state = { keys: fetched, fetchedAt: now };
      jwksByHost.set(host, state);
    }
  }

  return state?.keys.get(kid) ?? null;
}

/** Fetch and import the team's JWKS; returns kid -> key, or null on failure. */
async function fetchJwks(host: string): Promise<Map<string, CryptoKey> | null> {
  const res = await fetch(`https://${host}/cdn-cgi/access/certs`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) return null;

  const body = (await res.json()) as { keys?: Array<Record<string, unknown>> };
  if (!body || !Array.isArray(body.keys)) return null;

  const map = new Map<string, CryptoKey>();
  for (const jwk of body.keys) {
    const kid = typeof jwk.kid === 'string' ? jwk.kid : '';
    if (!kid || jwk.kty !== 'RSA' || typeof jwk.n !== 'string' || typeof jwk.e !== 'string') {
      continue;
    }
    try {
      const key = await crypto.subtle.importKey(
        'jwk',
        { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify'],
      );
      map.set(kid, key);
    } catch {
      // Skip any key that can't be imported; a single bad entry must not break
      // verification for the rest.
    }
  }
  return map.size > 0 ? map : null;
}

/** Decode one base64url JWT segment (JSON) into an object, or null on error. */
function decodeJsonSegment(segment: string): any {
  const bytes = base64urlToBytes(segment);
  const text = new TextDecoder().decode(bytes);
  return JSON.parse(text);
}

/** Decode a base64url string to raw bytes. */
function base64urlToBytes(input: string): Uint8Array {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const binary = atob(b64 + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
