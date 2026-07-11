# The Ridge

The community website for **The Ridge** — a young, distinct neighbourhood in
**South Courtenay, BC** on Vancouver Island. Built by residents, for residents.

The site has two equal jobs:

1. **Help neighbours connect** — community events, dog walks, people walks and
   bike rides.
2. **Give residents a united voice with the City of Courtenay** — so we can help
   shape the neighbourhood, kindly and constructively.

It's warm, plain-spoken, and welcoming — a friendly front porch for the whole
neighbourhood.

---

## Tech at a glance

- **[Astro 5](https://astro.build/)** — static site generator, plain CSS, no
  heavy framework.
- **Static output**, hosted on **[Cloudflare Pages](https://pages.cloudflare.com/)**.
- **Cloudflare Pages Functions** (in `/functions`) power the contact, volunteer
  and RSVP forms — independent of the Astro build, and safe to leave unconfigured.
- Content is **Markdown files** in `src/content/`, validated at build time.

You don't need a database or a server — the whole site is files.

---

## Run it locally

You'll need [Node.js](https://nodejs.org/) 18 or newer.

```bash
npm install     # install dependencies (first time only)
npm run dev      # start the dev server at http://localhost:4321
npm run build    # build the production site into dist/
npm run preview  # preview the production build locally
```

`npm run check` runs Astro's type/content checks if you want to validate before
building.

---

## Repository structure

```
theridge/
├─ public/                # static assets served as-is (images, favicon, /downloads)
├─ functions/             # Cloudflare Pages Functions (form back-ends) — NOT part of the Astro build
│  └─ api/
│     ├─ _shared.ts       # shared helpers: parsing, honeypot, Turnstile, Resend, JSON responses
│     ├─ contact.ts       # POST /api/contact
│     ├─ volunteer.ts     # POST /api/volunteer
│     └─ rsvp.ts          # POST /api/rsvp
├─ src/
│  ├─ components/         # reusable UI (RidgeMark, QRCode, cards, SignupForm…)
│  ├─ content/            # the editable content (Markdown) — see docs/editing-guide.md
│  │  ├─ events/  news/  positions/  groups/  meetings/
│  │  └─ config.ts        # content collection schemas (frontmatter fields)
│  ├─ layouts/            # BaseLayout (site pages) and PrintLayout (/print routes)
│  ├─ lib/                # small helpers (date formatting)
│  ├─ pages/              # routes — including /outreach and the /print/* kit
│  ├─ styles/             # tokens.css, global.css, print.css
│  └─ consts.ts           # site name, URL, contact email, navigation
├─ docs/
│  └─ editing-guide.md    # friendly, non-technical guide for content editors
├─ astro.config.mjs
└─ package.json
```

---

## Editing content

Content lives as Markdown files under `src/content/`. Add or edit a file, save it
to the repo, and Cloudflare rebuilds and publishes automatically (usually within
a minute).

**Full instructions for non-technical volunteers:** see
[`docs/editing-guide.md`](docs/editing-guide.md). It covers adding events, news,
City issues, groups and meetings, how images work, and the house style.

A visual editor (CMS) for click-and-type editing is planned as a fast-follow.

---

## The printable outreach kit

Volunteers can print flyers, a door-hanger and a sign-up sheet to spread the word
in person:

- **`/outreach`** — the kit hub, with links and a door-to-door canvassing guide.
- **`/print/flyer`**, **`/print/door-hanger`**, **`/print/signup-sheet`** —
  paper-ready pages with a one-click "Print / Save as PDF" button.

Finished PDF copies can also be dropped into `public/downloads/` for easy sharing.

---

## Turning on forms & newsletter

Everything works before any secrets exist: forms show a graceful **mailto:**
fallback, and the newsletter signup collects addresses by email until it's wired
up. To go live, set these in the **Cloudflare Pages dashboard**
(_Settings → Environment variables and secrets_) — no code change required:

| Variable               | Needed for      | What it is                                                            |
| ---------------------- | --------------- | -------------------------------------------------------------------- |
| `RESEND_API_KEY`       | sending email   | API key from [Resend](https://resend.com)                            |
| `CONTACT_TO`           | sending email   | the inbox that receives contact / volunteer / RSVP submissions       |
| `CONTACT_FROM`         | optional        | a **verified** Resend sender, e.g. `The Ridge <hello@theridge.dev>`  |
| `TURNSTILE_SECRET_KEY` | optional        | enables [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/) spam protection |

When `RESEND_API_KEY` and `CONTACT_TO` are both set, the form endpoints send
email. Without them, they return a friendly `503` so the front-end can guide
neighbours to email us instead. The newsletter (MailerLite) is a separate
fast-follow — see `src/components/SignupForm.astro`.

Secrets live only in the environment — never commit them. Local secrets go in a
`.dev.vars` file, which is git-ignored.

---

## Deploy to Cloudflare Pages

1. Connect this repository to a new **Cloudflare Pages** project.
2. Build settings:
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
3. Cloudflare automatically detects and deploys the `/functions` directory
   alongside the static site.
4. Add the environment variables above (when you're ready to enable forms).
5. Every push to the main branch triggers a fresh build and deploy. Pull requests
   get their own preview URL.

Once a custom domain is registered, update `SITE.url` / `SITE.displayUrl` in
`src/consts.ts` and `site` in `astro.config.mjs`.

---

## Roadmap / follow-ups

- **Visual CMS** for content editing (fast-follow) so volunteers can edit without
  touching files.
- **Newsletter signup** wired to MailerLite (currently a graceful mailto
  fallback in `SignupForm.astro`).
- **Real group inbox** — replace the placeholder `hello@ourridge.ca`
  with the shared address, and set `CONTACT_TO`.
- **Custom domain** — register it, then update `consts.ts` and `astro.config.mjs`.
- **Pre-made PDF downloads** under `public/downloads/` for the outreach kit.
- **Turnstile** spam protection on the public forms.

---

## Contributing

New neighbours welcome! The friendliest place to start is
[`docs/editing-guide.md`](docs/editing-guide.md). Questions? Email
**hello@ourridge.ca**. Let's shape this place together. 💛
