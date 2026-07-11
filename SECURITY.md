# Security Policy

The Ridge community website is a small, volunteer-run static site (Astro on
Cloudflare Workers). We appreciate responsible disclosure of any security issues.

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Instead:

- Use GitHub's **private vulnerability reporting** (Security tab → "Report a
  vulnerability"), if enabled, or
- Email **hello@ourridge.ca** with a description and steps to reproduce.

We'll acknowledge your report as soon as we reasonably can and keep you updated
as we work on a fix.

## Good to know

- **No secrets are committed** to this repository. API keys and tokens
  (Resend, MailerLite, Turnstile) live only in the Cloudflare environment.
- The site is static; the only server-side code is a small Cloudflare Worker
  (`worker/index.ts`) that handles the `/api/*` form and newsletter endpoints.
- Dependencies are kept current via Dependabot, and code is scanned with CodeQL.

Thank you for helping keep the neighbourhood's site safe. 💛
