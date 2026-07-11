// @ts-check
import { defineConfig } from 'astro/config';

// Static output — deploys to Cloudflare Pages. Dynamic bits (form email, newsletter)
// are handled by Cloudflare Pages Functions in /functions, independent of the Astro build.
// `site` is used for canonical URLs, sitemaps, the events.ics feed, and QR-code targets.
// Update this to the custom domain once it is registered (see SITE in src/consts.ts too).
export default defineConfig({
  site: 'https://theridge.pages.dev',
  output: 'static',
  trailingSlash: 'ignore',
});
