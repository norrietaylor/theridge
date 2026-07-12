import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/*
  Content collections = the editable "data" of the site. Each folder under
  src/content/ holds Markdown files; the frontmatter fields below are validated
  at build time so bad data is caught early and the CMS (worker/cms.ts) presents
  the right form fields.
*/

// Community events (also feed the home page and the .ics calendar).
const events = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/events' }),
  schema: z.object({
    title: z.string(),
    start: z.coerce.date(),
    end: z.coerce.date().optional(),
    time: z.string().optional(), // human-friendly, e.g. "10:00 AM – 11:30 AM"
    location: z.string().optional(),
    summary: z.string(),
    coordinator: z.string().optional(),
    coordinatorEmail: z.string().optional(),
    bring: z.string().optional(),
    image: z.string().optional(),
    imageAlt: z.string().optional(),
    rsvp: z.boolean().default(true),
    // `example: true` marks a suggested/illustrative event (not a confirmed date).
    // These show a "Suggested" badge and are kept out of the .ics calendar feed.
    example: z.boolean().default(false),
    draft: z.boolean().default(false),
  }),
});

// News & vision posts.
const news = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/news' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    category: z.enum(['Announcement', 'Development', 'Vision']).default('Announcement'),
    summary: z.string(),
    author: z.string().optional(),
    image: z.string().optional(),
    imageAlt: z.string().optional(),
    pinned: z.boolean().default(false),
    draft: z.boolean().default(false),
  }),
});

// Voice-to-the-City issues / positions.
const positions = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/positions' }),
  schema: z.object({
    title: z.string(),
    status: z.enum(['Watching', 'Active', 'Resolved']).default('Watching'),
    updated: z.coerce.date(),
    summary: z.string(),
    whatYouCanDo: z.array(z.string()).optional(),
    draft: z.boolean().default(false),
  }),
});

// Recurring community groups (dog walks, people walks, bike rides…).
const groups = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/groups' }),
  schema: z.object({
    name: z.string(),
    kind: z.enum(['Dog walk', 'People walk', 'Bike ride', 'Other']).default('Other'),
    schedule: z.string(), // e.g. "Saturdays, 9:00 AM"
    meetingPoint: z.string(),
    coordinator: z.string().optional(),
    summary: z.string(),
    order: z.number().default(50),
    draft: z.boolean().default(false),
  }),
});

// Upcoming City of Courtenay meeting dates relevant to the neighbourhood.
const meetings = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/meetings' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    kind: z.string().optional(), // "Council", "Committee of the Whole"…
    agendaUrl: z.string().optional(),
    note: z.string().optional(),
    draft: z.boolean().default(false),
  }),
});

// Community photo gallery. Binaries live in R2 (served at /media/...); each
// entry is a small Markdown file so the gallery stays versioned in git. Entries
// are created by editors or by approving a resident's photo submission (CMS).
const gallery = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/gallery' }),
  schema: z.object({
    image: z.string(), // e.g. /media/gallery/<uuid>.jpg
    caption: z.string().optional(),
    credit: z.string().optional(),
    date: z.coerce.date(),
    alt: z.string().optional(),
    order: z.number().default(50),
    draft: z.boolean().default(false),
  }),
});

export const collections = { events, news, positions, groups, meetings, gallery };
