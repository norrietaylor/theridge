# The Ridge CMS — one-time setup

This is the **human, one-time setup** for the visual CMS
([issue #5](https://github.com/norrietaylor/theridge/issues/5)). It's the
technical counterpart to [`editing-guide.md`](./editing-guide.md), which is for
the editors. You only do these steps once, when first turning the CMS on. None
of it is code you write; it's dashboards, one GitHub App, and a handful of
Worker secrets.

## How the pieces fit together

- **Cloudflare Access** (Zero Trust) is the front door. It protects `/admin*`
  (the editor UI) and `/cms*` (the gateway API), asks each editor for a one-time
  email code, and injects a signed identity header the Worker verifies.
- The **Worker** (`worker/index.ts` → `worker/cms.ts`) trusts that Access
  identity, then commits to the repo using a **GitHub App** installation token
  (the "bot"). The editor's email is stamped into each commit.
- **Content metadata stays in git** (Markdown in `src/content/**`). **Photos go
  to Cloudflare R2** (bucket `theridge-media`), served publicly at `/media/*`.
- **Publish** = a commit straight to `main`. The site already auto-deploys from
  `main` via **Cloudflare Workers Builds**, so a publish goes live in about one
  to two minutes with no manual step.

Already committed in `wrangler.jsonc` (nothing to do here, just so you know):
the R2 binding `MEDIA` → bucket `theridge-media`, and the non-secret vars
`GH_OWNER`, `GH_REPO`, `GH_BRANCH`.

---

## 1. Enable R2 and create the media bucket

1. In the **Cloudflare dashboard → R2**, complete the one-time **opt-in** for R2
   if you haven't used it on this account before (it asks you to accept the R2
   terms; there's a generous free tier).
2. Create a bucket named exactly **`theridge-media`**.
   - Dashboard: **R2 → Create bucket → `theridge-media`**, or
   - CLI: `wrangler r2 bucket create theridge-media`

The bucket name **must** match the `bucket_name` already in `wrangler.jsonc`
(binding `MEDIA`). Photos uploaded through the CMS land under `media/…` in this
bucket and are served at `/media/…`.

---

## 2. Create the GitHub App "The Ridge CMS"

We use a GitHub **App** (not a personal token) so commits come from a bot
identity with least-privilege permissions.

1. **GitHub → Settings → Developer settings → GitHub Apps → New GitHub App.**
2. Name: **The Ridge CMS**. Homepage URL: `https://ourridge.ca` (anything valid
   is fine). You can leave the webhook **unchecked / inactive**, the CMS doesn't
   use webhooks.
3. **Repository permissions** (only these three):
   - **Contents: Read and write** — to read and commit Markdown and read
     directory listings.
   - **Pull requests: Read and write** — reserved for the workflow.
   - **Metadata: Read-only** — required by GitHub for any app.
4. **Where can this app be installed?** "Only on this account" is fine.
5. Create the app, then on its page:
   - Record the **App ID** (a number near the top). → `GH_APP_ID`
   - **Generate a private key** (bottom of the page). GitHub downloads a `.pem`
     file. Keep it safe, it's a credential. → `GH_APP_PRIVATE_KEY` (see the
     format note below).
6. **Install** the app: on the app page → **Install App** → choose the
   `norrietaylor` account → **Only select repositories** → **`norrietaylor/theridge`**.
7. After installing, open the installation's settings. The URL ends in
   `/installations/<number>`, that number is the **Installation ID**. →
   `GH_APP_INSTALLATION_ID`

### Private key format (important)

The Worker imports the key as **PKCS#8 PEM**. GitHub hands you a **PKCS#1** key
(its header reads `-----BEGIN RSA PRIVATE KEY-----`). Convert it once:

```sh
openssl pkcs8 -topk8 -nocrypt \
  -in the-key-github-gave-you.pem \
  -out theridge-cms-pkcs8.pem
```

The converted file's header reads `-----BEGIN PRIVATE KEY-----`. Use **that**
file's full contents (header, body, footer, and newlines) as the
`GH_APP_PRIVATE_KEY` secret value.

---

## 3. Let the App publish to `main`

`main` is a **protected branch**, it requires a pull request review before
changes merge. That protection is good for humans, but it would block the bot's
**Publish** commits, which go directly to `main` so the site auto-deploys with
no human merge step.

Grant the App a **bypass**:

- **GitHub → repo `norrietaylor/theridge` → Settings → Branches** (or **Rules →
  Rulesets** if you use rulesets) → the rule protecting `main`.
- Add **The Ridge CMS** app to the list allowed to **bypass** the required pull
  request / status checks.

**Why:** Publish is a straight commit to `main` so it goes live in ~1–2 minutes
via Workers Builds. Without the bypass, every publish would sit unmerged behind
branch protection and never deploy. The bypass is scoped to this one app; human
contributors still go through PR review as normal.

---

## 4. Add the Cloudflare Access application

This is the email-code login and the server-side identity the Worker verifies.

1. **Cloudflare dashboard → Zero Trust → Access → Applications → Add an
   application → Self-hosted.**
2. **Application name:** `The Ridge CMS`.
3. **Application domains** — add both of these (same app, two paths):
   - `ourridge.ca/admin*`
   - `ourridge.ca/cms*`
4. **Policy:** one policy, action **Allow**, that matches the editors, e.g.
   **Emails** = the specific editor addresses (or an **Emails ending in** rule
   for a shared domain).
5. **Authentication method:** **One-time PIN** (email code). No identity
   provider is required, editors don't need Google/GitHub accounts.
6. Save, then open the application's settings and record:
   - The application **AUD tag** (Application Audience, a long hex string). →
     `CF_ACCESS_AUD`
   - Your **team domain**, e.g. `yourteam.cloudflareaccess.com` (or just the
     `yourteam` part). → `CF_ACCESS_TEAM_DOMAIN`

The Worker independently verifies the Access JWT against your team's public keys
and this AUD, so `/cms/*` can't be driven anonymously even if the edge gate were
somehow bypassed.

---

## 5. Set the Worker RUNTIME secrets

> **The build-vs-runtime trap (this bit the site before, see
> [issue #33](https://github.com/norrietaylor/theridge/issues/33)).** The
> Cloudflare dashboard has **two** separate "Variables and Secrets" sections. The
> one under **Build** is **build-time only** and is **invisible to the Worker at
> runtime**. The Worker's `env.*` only sees the one under
> **Settings → Variables and Secrets** (runtime). Put a runtime secret in the
> wrong place and every CMS call returns `503 not-configured`.

In the Worker (**Workers & Pages → `theridge`**), go to **Settings → Variables
and Secrets** (the **runtime** one) and add:

| Name | Type | Value |
| --- | --- | --- |
| `GH_APP_PRIVATE_KEY` | **Secret** | full contents of the **PKCS#8** `.pem` from step 2 |
| `GH_APP_ID` | Secret | App ID from step 2 |
| `GH_APP_INSTALLATION_ID` | Secret | Installation ID from step 2 |
| `CF_ACCESS_TEAM_DOMAIN` | Secret | team domain from step 4 |
| `CF_ACCESS_AUD` | Secret | AUD tag from step 4 |

CLI equivalent (each targets the runtime store, which is what you want):

```sh
wrangler secret put GH_APP_PRIVATE_KEY   # paste the PKCS#8 PEM, then Ctrl-D
wrangler secret put GH_APP_ID
wrangler secret put GH_APP_INSTALLATION_ID
wrangler secret put CF_ACCESS_TEAM_DOMAIN
wrangler secret put CF_ACCESS_AUD
```

Already handled, **don't** re-add these:

- `GH_OWNER`, `GH_REPO`, `GH_BRANCH` are **committed** as non-secret `vars` in
  `wrangler.jsonc`.
- The public **photo submission** form reuses the existing `TURNSTILE_SECRET_KEY`
  (runtime secret) and the build-time `PUBLIC_TURNSTILE_SITE_KEY` (which Astro
  inlines into the page at build, so it lives in the **Build** variables, not
  runtime). Both should already be set from the contact/newsletter forms.

Confirm what the Worker actually sees with `wrangler secret list` (runtime only).

---

## 6. Keep the public paths public

Two paths **must stay outside** the Access application, or the public site
breaks:

- **`/media/*`** — serves the published photos to everyone. If Access covers it,
  visitors can't see images.
- **`/api/photo-submit`** — the endpoint residents post their photo submissions
  to (protected instead by Turnstile + a honeypot). If Access covers it, the
  public form can't submit.

Because the Access application in step 4 is scoped to `ourridge.ca/admin*` and
`ourridge.ca/cms*` only, these are already outside it. Just don't add a broader
domain (like `ourridge.ca/*` or `ourridge.ca/api*`) that would swallow them.

---

## Acceptance test

Mirrors the acceptance criteria in
[issue #5](https://github.com/norrietaylor/theridge/issues/5), adjusted to this
build (custom admin, draft/publish via the `draft` flag, R2 photo upload,
resident submission → moderation → gallery).

1. **Editor login (no GitHub account).** An allow-listed editor opens
   `ourridge.ca/admin`, receives a one-time email code from Cloudflare Access,
   and signs in. Their email shows at the top of the editor.
2. **Edit with a photo.** They create a **news** post and an **event** through
   the forms, including a working **photo upload** (thumbnail appears; the file
   lands under `media/…` in R2 and renders from `/media/…`) and a rich-text
   body. The live preview reflects what they type.
3. **Draft vs Publish.** **Save draft** keeps the item hidden (Draft badge; the
   published site does not show it). **Publish** commits to `main`; within ~1–2
   minutes the change is **live** on the site.
4. **Content still validates.** The committed Markdown passes the content
   schemas (`npm run build` succeeds, Workers Builds deploys).
5. **Access is enforced.** A non-allow-listed user is blocked by Cloudflare
   Access at `/admin`. A request to any `/cms/*` route **without a valid Access
   JWT is rejected** (401), so the bot can't be driven anonymously.
6. **Resident submission → moderation → gallery.** A visitor submits a photo at
   `/submit-photo` (public, Turnstile-gated). It appears **only** in the editor's
   **Photo submissions** queue, never publicly, until an editor **Approves** it;
   on approval it appears in the community **Gallery** within ~1–2 minutes. A
   **Reject** removes it. Confirm `/media/*` and `/api/photo-submit` are reachable
   **without** signing in.

If step 5 lets an unauthenticated `/cms/*` call through, or step 2's photo 503s,
re-check step 5's **runtime** secrets, that's the build-vs-runtime trap again.
