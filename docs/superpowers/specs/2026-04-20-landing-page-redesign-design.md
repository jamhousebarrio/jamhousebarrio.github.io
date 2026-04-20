# Landing Page Redesign

## Goal

Replace the current text-only homepage with a short, emotionally approachable
page built around 3 interleaved photo/text story beats. Photos convey the mood;
copy is warm and concise.

## Story beats

Three alternating photo/text blocks (L/R zigzag on desktop, stacked on mobile):

### Beat 1 — Who we are

> JamHouse is a barrio of musicians and music lovers at Elsewhere, now in our
> 3rd year on the playa. We come from all over the world — artists, engineers,
> chefs, wanderers — an international mix that speaks the shared language of
> music. Some of us are seasoned musicians, some are honorable groupies. What
> unites us is how much we love the music.

### Beat 2 — What happens here

Heading: "What happens here"

List (friendly phrasing, not bullet-stacked marketing):
- Open stages and impromptu jam sessions
- Shared instruments, amps, drums, guitars, mics
- Group singalongs under the desert sky
- Tasty meals and cold drinks
- A shower with actual good pressure
- A shaded, welcoming home on the playa
- Kind, supportive people who've got your back

### Beat 3 — Come join us

Warm invitation paragraph + **Apply for Membership** button linking to `/apply`.

Below the CTA, a single line:
> JamHouse is part of [Elsewhere 2026](https://nobodies.team) — a participatory
> burn event in the Aragon desert, July 2026.

## Layout

- Each beat: CSS flex row, ~50/50 split between photo cluster and text block
- Alternating sides (L/R/L) for visual rhythm
- Photo cluster = 3-4 photos arranged in a small grid (e.g. 1 large + 2 small)
- Mobile (< 720px): stacks vertically, photos above text per beat
- Reuses the existing site layout (`layout: default`) and site CSS variables
- Lightbox on click, matching the pattern in `admin/info.html`
  (full-screen overlay, prev/next arrows, close on click outside)

## Photos

- Source directory: `/assets/images/home/` (new)
- Filename convention: `home-1.jpg`, `home-2.jpg`, … up to `home-15.jpg`
- Assignment to beats: the template declares a fixed mapping per beat
  (e.g. beat 1 uses `home-1..home-4`, beat 2 uses `home-5..home-9`, beat 3
  uses `home-10..home-13`); photos not yet added degrade gracefully by omitting
  the tile (handled in the template with `if` guards on file existence via a
  Jekyll `files` list — OR simpler: hard-code filenames and tolerate 404s
  until photos are added).
- All `<img>` tags include `loading="lazy"` and descriptive `alt` text
- No image processing in the build — photos are served as dropped in

## Implementation notes

- Rewrite `index.md` → either keep as Markdown with inline HTML blocks, or
  convert to `index.html` with `layout: default` if the interleaving requires
  heavy HTML. Markdown-with-HTML is preferred to keep the site consistent.
- Styles: add a small scoped section to the default layout's stylesheet (or a
  new `assets/css/home.css` included from `index`) — keep it under ~100 lines.
  Reuse existing CSS variables (`--accent`, `--text`, `--body`, `--heading`).
- Lightbox JS: extract the lightbox logic from `admin/info.html` into a small
  shared snippet if it's reused; otherwise inline a ~30-line script on the
  home page.
- No Jekyll plugins needed.

## Out of scope

- Drafting "Where we are" as a standalone section (dropped per user)
- Carousel / autoplay slideshow
- Copy in multiple languages
- Any changes to `apply.html`, admin pages, or APIs
- Image optimisation pipeline / responsive `srcset`

## Success criteria

- Homepage renders with the 3 beats in the approved copy
- Photos dropped into `/assets/images/home/` appear without code changes
- Layout is readable and feels warm on both desktop and mobile
- Clicking a photo opens a lightbox that can be dismissed
- Apply CTA links to `/apply`, nobodies.team link opens the festival page
