/**
 * Cloudflare Turnstile server-side verification.
 *
 * Shared by the form endpoints (worker/index.ts) and the public photo
 * submission endpoint (worker/media.ts). When no secret is configured the
 * check is not enforced (returns true), matching the site's "degrade safely"
 * behaviour for optional secrets.
 */
export async function verifyTurnstile(
  secret: string | undefined,
  token: string,
  ip: string | null,
): Promise<boolean> {
  if (!secret) return true; // not enforced unless a secret is set
  if (!token) return false;
  const body = new FormData();
  body.append('secret', secret);
  body.append('response', token);
  if (ip) body.append('remoteip', ip);
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body,
  });
  const data = (await res.json()) as { success?: boolean };
  return !!data.success;
}
