// @ts-check
import { defineConfig } from 'astro/config';

// Static output, deployed to Cloudflare Workers with static assets. Dynamic bits
// (form email, newsletter) are handled by the Worker in worker/index.ts (/api/*),
// which reads its secrets at runtime, independent of the Astro build.
// `site` is used for canonical URLs, sitemaps, the events.ics feed, and QR-code targets.
// The community's own domain (also set in src/consts.ts).
export default defineConfig({
  site: 'https://ourridge.ca',
  output: 'static',
  trailingSlash: 'ignore',
});
