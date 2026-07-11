# The Ridge

The community website for **The Ridge**, a young, distinct neighbourhood in
**South Courtenay, BC** on Vancouver Island. Built by residents, for residents.

The site has two equal jobs:

1. **Help neighbours connect**, community events, dog walks, people walks and
   bike rides.
2. **Give residents a united voice with the City of Courtenay**, so we can help
   shape the neighbourhood, kindly and constructively.

It's warm, plain-spoken, and welcoming, a friendly front porch for the whole
neighbourhood.

---

## Tech at a glance

- **[Astro 5](https://astro.build/)**, static site generator, plain CSS, no
  heavy framework.
- **Static output**, deployed to **[Cloudflare Workers](https://developers.cloudflare.com/workers/static-assets/)** with static assets.
- A small **Cloudflare Worker** (`worker/index.ts`) serves the site and powers the
  contact, volunteer, RSVP and newsletter endpoints under `/api/*`, safe to leave
  unconfigured (they fall back to email until secrets are set).
- Content is **Markdown files** in `src/content/`, validated at build time.

You don't need a database or a server, the whole site is files.

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
├─ worker/                # Cloudflare Worker, serves the static site + /api/* endpoints
│  └─ index.ts            # contact / volunteer / rsvp (Resend) + subscribe (MailerLite)
├─ src/
│  ├─ components/         # reusable UI (RidgeMark, QRCode, cards, SignupForm…)
│  ├─ content/            # the editable content (Markdown), see docs/editing-guide.md
│  │  ├─ events/  news/  positions/  groups/  meetings/
│  │  └─ config.ts        # content collection schemas (frontmatter fields)
│  ├─ layouts/            # BaseLayout (site pages) and PrintLayout (/print routes)
│  ├─ lib/                # small helpers (date formatting)
│  ├─ pages/              # routes, including /outreach and the /print/* kit
│  ├─ styles/             # tokens.css, global.css, print.css
│  └─ consts.ts           # site name, URL, contact email, navigation
├─ docs/
│  └─ editing-guide.md    # friendly, non-technical guide for content editors
├─ astro.config.mjs
├─ wrangler.jsonc        # Cloudflare Worker + static-assets config
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

- **`/outreach`**, the kit hub, with links and a door-to-door canvassing guide.
- **`/print/flyer`**, **`/print/door-hanger`**, **`/print/signup-sheet`**, 
  paper-ready pages with a one-click "Print / Save as PDF" button.

Finished PDF copies can also be dropped into `public/downloads/` for easy sharing.

---

## Turning on forms & newsletter

Everything works before any secrets exist: the `/api/*` endpoints return a
friendly `503` and the front-end falls back to a pre-filled **email**. To go
live, add these to the **Worker** in the Cloudflare dashboard
(_your Worker → Settings → Variables and Secrets_), no code change required:

| Variable               | Needed for        | What it is                                                                            |
| ---------------------- | ----------------- | ------------------------------------------------------------------------------------- |
| `RESEND_API_KEY`       | contact/RSVP mail | API key from [Resend](https://resend.com)                                             |
| `CONTACT_TO`           | contact/RSVP mail | inbox that receives submissions, e.g. `hello@ourridge.ca`                             |
| `CONTACT_FROM`         | optional          | a **verified** Resend sender, e.g. `The Ridge <hello@ourridge.ca>`                    |
| `MAILERLITE_API_KEY`   | newsletter        | API key from [MailerLite](https://www.mailerlite.com)                                 |
| `MAILERLITE_GROUP_ID`  | optional          | target list/group id for new subscribers                                              |
| `TURNSTILE_SECRET_KEY` | optional          | server side of [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/) spam checks |

One **build-time** variable turns on the Turnstile widget in the browser (set it
as a build environment variable, not a Worker secret):

| Variable                    | Needed for | What it is                         |
| --------------------------- | ---------- | ---------------------------------- |
| `PUBLIC_TURNSTILE_SITE_KEY` | optional   | public Turnstile site key (widget) |

When the relevant secrets are set, the endpoints send email / add subscribers;
without them they return `503` and the front-end guides neighbours to email
instead. Verify `ourridge.ca` as a sending domain in Resend (DNS records), and
enable **double opt-in** in MailerLite for Canadian anti-spam (CASL) compliance.

Secrets live only in the environment, never commit them. Local secrets go in a
`.dev.vars` file, which is git-ignored.

---

## Deploy to Cloudflare

The site deploys to **Cloudflare Workers** with static assets. Config lives in
`wrangler.jsonc` (`npm run build` → `dist/`, uploaded by `npx wrangler deploy`).

1. Connect this repository in the Cloudflare dashboard (**Workers & Pages →
   Create → import the repo**), or run `npx wrangler deploy` from a checkout.
2. Build command `npm run build`, deploy command `npx wrangler deploy`, and set
   `NODE_VERSION` to `20` (or `22`).
3. Add the secrets above (when you're ready to enable forms/newsletter).
4. Every push to the main branch builds and deploys; the Worker serves both the
   static pages and the `/api/*` endpoints.

Once a custom domain is registered, update `SITE.url` / `SITE.displayUrl` in
`src/consts.ts` and `site` in `astro.config.mjs`.

---

## Roadmap / follow-ups

- **Visual CMS** for content editing (fast-follow) so volunteers can edit without
  touching files.
- **Real content**, replace the placeholder copy and suggested events with the
  real thing.
- **Pre-made PDF downloads** under `public/downloads/` for the outreach kit.

---

## Contributing

New neighbours welcome! The friendliest place to start is
[`docs/editing-guide.md`](docs/editing-guide.md). Questions? Email
**hello@ourridge.ca**. Let's shape this place together. 💛
