# Editing guide — adding content to The Ridge website

Hello, and thank you for helping keep The Ridge website alive! This guide is for
**non-technical volunteers**. You don't need to be a programmer — if you can fill
in a form and save a file, you can add an event, a news post, a group, or a City
issue.

> **The short version:** each piece of content is a small text file with a few
> labelled fields at the top. Add a file, save it to the project, and the website
> rebuilds and publishes itself automatically — usually within a minute or two.

A friendlier, click-and-type visual editor (a **CMS**) is coming as a fast-follow.
Until then, this guide is all you need.

---

## How publishing works

The website is **static** — it's rebuilt from these text files every time the
project changes, and hosted on **Cloudflare Pages**.

1. You add or edit a Markdown (`.md`) file in the right folder (see below).
2. You save it to the project (commit/push, or use the GitHub website's
   "Add file" button).
3. Cloudflare notices the change, rebuilds the site, and publishes it — no extra
   step needed. Give it a minute, then refresh the page.

If something in a file is wrong (a missing field, a bad date), the build will
stop rather than publish something broken. Don't worry — nothing goes live until
it's valid, and you can fix the file and save again.

---

## Where content lives

Every kind of content has its own folder under `src/content/`:

| I want to add…            | Folder                    |
| ------------------------- | ------------------------- |
| A community event         | `src/content/events/`     |
| A news or vision post     | `src/content/news/`       |
| A City issue / position   | `src/content/positions/`  |
| A walking / riding group  | `src/content/groups/`     |
| A City meeting date       | `src/content/meetings/`   |

**Naming files:** use lowercase words with hyphens and end in `.md`, e.g.
`summer-park-day.md` or `traffic-on-ridge-road.md`. The file name becomes part of
the web address, so keep it short and descriptive.

**Dates** are always written as `YYYY-MM-DD` (year-month-day), e.g. `2026-07-18`.
Type them plainly, with no time zone.

**The `draft` field:** set `draft: true` to keep something hidden while you work
on it. Set it to `false` (or remove the line) when it's ready to go live.

---

## The anatomy of a content file

Every file has two parts:

```md
---
title: Summer Park Day
start: 2026-07-25
summary: A relaxed afternoon in the park — bring a blanket and say hello.
---

Write the longer description here, in plain paragraphs.
You can use **bold**, _italics_, and [links](https://example.com).
```

The bit **between the two `---` lines** is called the *frontmatter* — those are
the labelled fields. The bit **below** is the free-text body (optional for some
types). Copy one of the templates below and change the values.

---

## Templates — copy, paste, and edit

### Add an event → `src/content/events/your-event.md`

```md
---
title: Summer Park Day
start: 2026-07-25          # required — the day it happens (YYYY-MM-DD)
end: 2026-07-25           # optional — only for multi-day events
time: "1:00 PM – 4:00 PM" # optional — friendly time text, in quotes
location: Ridgeview Park
summary: A relaxed afternoon in the park — bring a blanket and say hello.
coordinator: Ron Taylor    # optional — who's organising
coordinatorEmail: hello@ourridge.ca  # optional
bring: A picnic and a lawn chair            # optional
rsvp: true                 # true shows an RSVP button; false hides it
draft: false
---

A longer, warm description of the event goes here. What to expect, who it's for,
where to park — anything that helps a neighbour feel welcome to come along.
```

### Add a news / vision post → `src/content/news/your-post.md`

```md
---
title: A warm welcome to the Ridge website
date: 2026-07-11           # required — the publish date
category: Announcement     # Announcement | Development | Vision
summary: One or two friendly sentences shown in the news list.
author: Ron Taylor         # optional
image: /images/welcome.jpg # optional — see "Adding images" below
pinned: false              # true keeps it at the top of the news list
draft: false
---

The full post goes here, in plain paragraphs. Keep it warm and to the point.
```

### Add a City issue / position → `src/content/positions/your-issue.md`

```md
---
title: Safer crossings on Ridge Road
status: Watching           # Watching | Active | Resolved
updated: 2026-07-11        # required — when you last updated this
summary: What the issue is, in one or two calm, factual sentences.
whatYouCanDo:              # optional — a short list of neighbourly actions
  - Share your experience at the next Council meeting
  - Add your name to the mailing list to stay informed
draft: false
---

Background and context in plain language. Stick to what's known; keep the tone
constructive rather than combative.
```

### Add a group (walk / ride) → `src/content/groups/your-group.md`

```md
---
name: Saturday Morning Dog Walk
kind: Dog walk             # Dog walk | People walk | Bike ride | Other
schedule: "Saturdays, 9:00 AM"
meetingPoint: The trailhead at the top of the main path
coordinator: volunteer needed   # a first name, or "volunteer needed"
summary: An easy loop with the dogs — all breeds and paces welcome.
order: 10                  # lower numbers show first
draft: false
---

Optional extra detail — the usual route, how long it takes, what to bring.
```

### Add a City meeting date → `src/content/meetings/your-meeting.md`

```md
---
title: City of Courtenay — Regular Council Meeting
date: 2026-07-21
kind: Council              # optional — "Council", "Committee of the Whole"…
agendaUrl: https://www.courtenay.ca/  # optional — link to the official agenda
note: Item of interest — neighbourhood traffic review   # optional
draft: false
---
```

---

## Adding images

1. Put the image file in the `public/` folder — a subfolder like
   `public/images/` keeps things tidy.
2. Reference it in frontmatter by its path **starting with a slash**, dropping
   the word `public`. So `public/images/welcome.jpg` becomes:

   ```md
   image: /images/welcome.jpg
   ```

Tips:

- Use `.jpg` for photos and `.png`/`.svg` for logos or graphics.
- Keep photos a reasonable size (roughly 1600px wide is plenty) so pages load
  quickly.
- Always describe your photo honestly — good **alt text** helps neighbours using
  screen readers. When a field or the future editor asks for alt text, write what
  you'd say to someone who can't see the picture (e.g. "Families gathered on a
  grassy hill at sunset").

---

## House style — how we sound

The Ridge is warm, plain-spoken, and neighbourly. A few gentle rules:

- **Be warm and welcoming.** "All welcome", "come as you are", "let's shape this
  together". Invite people in.
- **Be plain.** Short sentences. Everyday words, not bureaucratic ones.
- **Be constructive**, especially on City issues. We raise concerns kindly and
  focus on solutions — never pick fights.
- **Be honest.** Don't state guesses as facts. If you're unsure of a number, a
  date, or a decision, keep it general or leave it out.
- **Real names:** our founder is **Ron Taylor** (call him "Ron"). For roles that
  aren't filled, write "volunteer needed" rather than inventing a name.

---

## Stuck?

- Double-check your dates are `YYYY-MM-DD` and any `time:` value is wrapped in
  "quotes".
- Make sure the top of the file has the opening and closing `---` lines.
- If the site doesn't update after a couple of minutes, the build may have caught
  an error — ask a teammate to check the Cloudflare deploy log, fix the file, and
  save again.

Questions? Email **hello@ourridge.ca**. Thank you for pitching in. 💛
