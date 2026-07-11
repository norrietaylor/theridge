// @ts-check
import { defineConfig } from 'astro/config';

// Static output — deploys to Cloudflare Pages. Dynamic bits (form email, newsletter)
// are handled by Cloudflare Pages Functions in /functions, independent of the Astro build.
// `site` is used for canonical URLs, sitemaps, the events.ics feed, and QR-code targets.
// The community's own domain (also set in src/consts.ts).
export default defineConfig({
  site: 'https://ourridge.ca',
  output: 'static',
  trailingSlash: 'ignore',
});
