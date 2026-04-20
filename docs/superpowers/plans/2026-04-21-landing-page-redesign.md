# Landing Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static text-only home page with a hero + 3 interleaved photo/text story beats ("Who we are", "What happens here", "Come join us") built from Markdown with inline HTML and photo clusters enumerated from `/assets/images/home/{who,what,join}/`.

**Architecture:** Keep the existing hero in `_layouts/default.html` as the first impression. Route `{{ content }}` through the `page-home` branch so `index.md` renders below the hero. Write the 3 beats as HTML blocks in `index.md`, each with a text column and a photo cluster. Photos in subfolders, enumerated at build time via `site.static_files`. Lightbox on photo click — small inline script pattern borrowed from `admin/info.html`.

**Tech Stack:** Jekyll static site, vanilla CSS/JS, no build tooling beyond Jekyll.

**Spec:** `docs/superpowers/specs/2026-04-20-landing-page-redesign-design.md`

**Verification approach:** No automated tests. Each task ends with a local Jekyll build check (`bundle exec jekyll serve` — or Vercel's built-in Jekyll if no local Jekyll) and a visual verification in the browser. Note: `dev-server.mjs` doesn't build Jekyll, so home-page work needs either Jekyll installed locally OR verification on the Vercel preview deploy.

---

## File structure

### Modified

- `_layouts/default.html` — render `{{ content }}` in the `page-home` branch; add home-section CSS; add lightbox overlay + script
- `index.md` — rewrite content: 3 beat blocks with photo clusters

### Created

- `assets/images/home/who/.gitkeep`
- `assets/images/home/what/.gitkeep`
- `assets/images/home/join/.gitkeep`

### Not touched

- `apply.html`, admin pages, APIs, other layouts

---

## Chunk 1: Plumb content through + add empty beat scaffolding

### Task 1: Let `{{ content }}` render below the hero on the home page

**Files:**
- Modify: `_layouts/default.html`

- [ ] **Step 1.1: Inject `{{ content }}` into the page-home branch**

In `_layouts/default.html`, change the `{% if page.body_class == "page-home" %}` branch (around line 225-236) to add a `<main class="home-content">{{ content }}</main>` element AFTER the closing `</section>` of `.hero` but BEFORE the `{% else %}`:

```html
{% if page.body_class == "page-home" %}
<section class="hero">
  <!-- ... existing hero markup unchanged ... -->
</section>
<main class="home-content">
  {{ content }}
</main>
{% else %}
```

- [ ] **Step 1.2: Remove the `display: none` that hides markdown on page-home**

Delete the rule `.page-home .content { display: none; }` (line ~214 in the `<style>` block). It currently targets a `.content` wrapper not rendered in the page-home branch anyway, but we're introducing `.home-content` below and want to be explicit — no display:none on any home sub-container.

- [ ] **Step 1.3: Verify home page builds and renders existing markdown**

Reload the home page (Vercel preview or local Jekyll). The existing `index.md` content (the current `# The JamHouse` markdown) should appear beneath the hero. Looks messy and unstyled — that's fine, Task 2 replaces it.

- [ ] **Step 1.4: Commit**

```bash
git add _layouts/default.html
git commit -m "Home: render index.md content below the hero"
```

---

### Task 2: Create the photo folders

**Files:**
- Create: `assets/images/home/who/.gitkeep`
- Create: `assets/images/home/what/.gitkeep`
- Create: `assets/images/home/join/.gitkeep`

- [ ] **Step 2.1: Create the three folders with `.gitkeep` placeholders**

```bash
mkdir -p assets/images/home/who assets/images/home/what assets/images/home/join
touch assets/images/home/who/.gitkeep
touch assets/images/home/what/.gitkeep
touch assets/images/home/join/.gitkeep
```

- [ ] **Step 2.2: Commit**

```bash
git add assets/images/home/
git commit -m "Home: add empty photo subfolders (who/what/join)"
```

---

## Chunk 2: Write the beats and photo clusters

### Task 3: Rewrite `index.md` with the 3 beats

**Files:**
- Modify: `index.md`

- [ ] **Step 3.1: Replace the markdown content with the 3 beats**

Overwrite `index.md` with the following. Frontmatter stays the same; the body becomes HTML blocks with Liquid loops:

```markdown
---
layout: default
title: JamHouse 2026
body_class: page-home
---

<section class="beat beat-left" id="beat-who">
  <div class="beat-text">
    <h2>Who we are</h2>
    <p>JamHouse is a barrio of musicians and music lovers at <a href="https://nobodies.team">Elsewhere</a>, now in our 3rd year on the playa. We come from all over the world — artists, engineers, chefs, wanderers — an international mix that speaks the shared language of music.</p>
    <p>Some of us are seasoned musicians, some are honorable groupies. What unites us is how much we love the music.</p>
  </div>
  <div class="beat-photos">
    {% assign photos = site.static_files | where_exp: "f", "f.path contains '/assets/images/home/who/'" | where_exp: "f", "f.extname != '.gitkeep'" %}
    {% for photo in photos %}
      <img src="{{ photo.path }}" alt="JamHouse moment" loading="lazy" class="beat-photo">
    {% endfor %}
  </div>
</section>

<section class="beat beat-right" id="beat-what">
  <div class="beat-text">
    <h2>What happens here</h2>
    <ul class="beat-list">
      <li>Open stages and impromptu jam sessions</li>
      <li>Shared instruments — amps, drums, guitars, mics</li>
      <li>Group singalongs under the desert sky</li>
      <li>Tasty meals and cold drinks</li>
      <li>A shower with actual good pressure</li>
      <li>A shaded, welcoming home on the playa</li>
      <li>Kind, supportive people who've got your back</li>
    </ul>
  </div>
  <div class="beat-photos">
    {% assign photos = site.static_files | where_exp: "f", "f.path contains '/assets/images/home/what/'" | where_exp: "f", "f.extname != '.gitkeep'" %}
    {% for photo in photos %}
      <img src="{{ photo.path }}" alt="JamHouse moment" loading="lazy" class="beat-photo">
    {% endfor %}
  </div>
</section>

<section class="beat beat-left" id="beat-join">
  <div class="beat-text">
    <h2>Come join us</h2>
    <p>We're looking for people who want to be part of JamHouse for 2026. Musicians and non-musicians welcome — we need builders, cooks, and good energy just as much as we need guitar players.</p>
    <p><a href="/apply" class="beat-cta">Apply for Membership</a></p>
    <p class="beat-footnote">JamHouse is part of <a href="https://nobodies.team">Elsewhere 2026</a> — a participatory burn event in the Aragon desert, July 2026.</p>
  </div>
  <div class="beat-photos">
    {% assign photos = site.static_files | where_exp: "f", "f.path contains '/assets/images/home/join/'" | where_exp: "f", "f.extname != '.gitkeep'" %}
    {% for photo in photos %}
      <img src="{{ photo.path }}" alt="JamHouse moment" loading="lazy" class="beat-photo">
    {% endfor %}
  </div>
</section>
```

Notes:
- Each beat has `beat-left` or `beat-right` — determines which side the photos land on in desktop grid.
- The `where_exp` with `f.extname != '.gitkeep'` filters out the placeholder file so it doesn't try to render as an image.
- Until photos are added, the `.beat-photos` containers are empty but still occupy layout space (we'll use CSS min-height so the layout doesn't collapse).

- [ ] **Step 3.2: Verify the home page renders 3 empty beats**

Reload. You should see the hero, then below it 3 sections with the beat text (headings + paragraphs + the bullet list) and empty photo panels. No layout styling yet — it'll look like a pile of text, that's fine.

- [ ] **Step 3.3: Commit**

```bash
git add index.md
git commit -m "Home: write 3 story beats in index.md with photo enumerators"
```

---

### Task 4: Style the beats (desktop + mobile)

**Files:**
- Modify: `_layouts/default.html`

- [ ] **Step 4.1: Add home-section CSS to the `<style>` block**

In `_layouts/default.html`, inside the `<style>` block (anywhere under `/* ---- HOME PAGE ---- */` is fine), add:

```css
/* ---- HOME PAGE BEATS ---- */
.home-content { max-width: 1100px; margin: 0 auto; padding: 60px 24px; }
.beat { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; align-items: center; margin: 80px 0; }
.beat:first-child { margin-top: 0; }
.beat-right .beat-text { order: 2; }
.beat-right .beat-photos { order: 1; }
.beat-text h2 { font-family: var(--heading); font-size: clamp(1.6rem, 3.5vw, 2.2rem); font-weight: 700; color: var(--accent); margin-bottom: 16px; letter-spacing: -0.01em; }
.beat-text p { font-size: 1.02rem; color: var(--text); line-height: 1.7; margin-bottom: 14px; }
.beat-text p:last-of-type { margin-bottom: 0; }
.beat-text a { color: var(--accent); text-decoration: none; border-bottom: 1px solid transparent; transition: border-color 0.15s; }
.beat-text a:hover { border-bottom-color: var(--accent); }
.beat-list { list-style: none; padding: 0; display: grid; grid-template-columns: 1fr; gap: 8px; }
.beat-list li { font-size: 1rem; color: var(--text); padding-left: 22px; position: relative; line-height: 1.5; }
.beat-list li::before { content: "♪"; position: absolute; left: 0; color: var(--accent); font-size: 1rem; }
.beat-cta { display: inline-block; margin-top: 8px; padding: 12px 36px; background: var(--accent); color: var(--bg) !important; font-family: var(--heading); font-weight: 600; font-size: 1rem; border-radius: 6px; text-decoration: none !important; border: none !important; box-shadow: 0 0 30px var(--accent-glow); transition: transform 0.15s, box-shadow 0.15s; }
.beat-cta:hover { transform: translateY(-2px); box-shadow: 0 0 50px var(--accent-glow); border: none !important; }
.beat-footnote { font-size: 0.88rem; color: var(--text-muted); margin-top: 24px !important; font-style: italic; }
.beat-photos { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; min-height: 220px; }
.beat-photo { width: 100%; height: 100%; object-fit: cover; aspect-ratio: 1; border-radius: 8px; cursor: pointer; transition: transform 0.2s, opacity 0.2s; opacity: 0.92; }
.beat-photo:hover { transform: scale(1.02); opacity: 1; }
.beat-photos:empty::before { content: "Photos coming soon"; grid-column: 1 / -1; display: flex; align-items: center; justify-content: center; color: var(--text-muted); font-style: italic; border: 1px dashed var(--border); border-radius: 8px; min-height: 200px; }
@media (max-width: 800px) {
  .home-content { padding: 40px 16px; }
  .beat { grid-template-columns: 1fr; gap: 24px; margin: 48px 0; }
  .beat-right .beat-text { order: 2; }
  .beat-right .beat-photos { order: 1; }
  .beat-left .beat-text { order: 2; }
  .beat-left .beat-photos { order: 1; }
}
```

Notes:
- On mobile (< 800px), all beats stack photos-first / text-second, losing the L/R zigzag (cleaner).
- The musical-note "♪" bullet for the list is a small identity touch matching JamHouse.
- `.beat-photos:empty::before` shows "Photos coming soon" placeholder when no files exist in the folder — prevents the layout from collapsing.

- [ ] **Step 4.2: Verify layout**

Reload. Expect:
- Desktop (wide): 3 beats alternating text L / photos R, then photos L / text R, then text L / photos R. Each beat has a headline, body text, photo grid. Empty photo grids show the "Photos coming soon" placeholder in a dashed box.
- Mobile (narrow): stacked, photos above text for each beat.
- Apply CTA in beat 3 is a pill-shaped accent button.
- Hover on photos: subtle scale.

- [ ] **Step 4.3: Commit**

```bash
git add _layouts/default.html
git commit -m "Home: style beats — L/R zigzag, photo grid, mobile stack"
```

---

## Chunk 3: Lightbox + polish

### Task 5: Add a lightbox for the photos

**Files:**
- Modify: `_layouts/default.html`

- [ ] **Step 5.1: Add the lightbox overlay HTML and script inside the page-home branch**

In `_layouts/default.html`, inside the `page-home` branch, BELOW the `</main>` of `.home-content`, add:

```html
<div id="home-lightbox" class="home-lightbox" onclick="this.classList.remove('active')">
  <img id="home-lightbox-img" alt="" />
</div>
<script>
(function () {
  var lb = document.getElementById('home-lightbox');
  var img = document.getElementById('home-lightbox-img');
  document.querySelectorAll('.beat-photo').forEach(function (p) {
    p.addEventListener('click', function () {
      img.src = p.src;
      lb.classList.add('active');
    });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') lb.classList.remove('active');
  });
})();
</script>
```

- [ ] **Step 5.2: Add CSS for the lightbox**

In the same `<style>` block (right after the beats CSS), add:

```css
.home-lightbox { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.92); z-index: 1000; align-items: center; justify-content: center; cursor: zoom-out; padding: 40px; }
.home-lightbox.active { display: flex; }
.home-lightbox img { max-width: 95%; max-height: 95%; object-fit: contain; border-radius: 6px; box-shadow: 0 10px 60px rgba(0,0,0,0.8); }
```

- [ ] **Step 5.3: Verify**

Once photos exist (or now, by temporarily dropping a JPG into `assets/images/home/who/`), clicking any photo should open a fullscreen overlay with the image. Click anywhere outside the image (or press Esc) to close.

- [ ] **Step 5.4: Commit**

```bash
git add _layouts/default.html
git commit -m "Home: lightbox overlay on photo click"
```

---

### Task 6: Tidy the hero copy to avoid overlap with beat 1

**Files:**
- Modify: `_layouts/default.html`

**Context:** The current hero description duplicates the "Who we are" beat's intent and has some outdated riffs (shower joke, "delicious blend"). Simplify the hero to a punchier tagline, since Beat 1 now carries the full intro.

- [ ] **Step 6.1: Replace the hero description**

In `_layouts/default.html` around line 231, replace the `<p class="hero-desc">...</p>` with:

```html
<p class="hero-desc">Live music barrio. Third year on the playa. Built on loud, unrehearsed joy.</p>
```

Leave the rest (title, subtitle, CTA, hero-info line) unchanged.

- [ ] **Step 6.2: Verify**

Reload. The hero is now more concise — title / subtitle / one-line vibe / CTA / location line. Beat 1 below fills in the real description. No copy feels duplicated.

- [ ] **Step 6.3: Commit**

```bash
git add _layouts/default.html
git commit -m "Home: tighten hero copy now that beat 1 carries the intro"
```

---

## Final verification

- [ ] **Push and smoke-test on the Vercel preview**

```bash
git push
```

Vercel builds Jekyll. On the deployed URL:
1. Hero renders with the new tagline.
2. Scrolling below reveals 3 beats with alternating L/R layout.
3. Empty photo grids show "Photos coming soon" placeholders.
4. Mobile: stack layout, readable.
5. Apply CTA in beat 3 works.
6. nobodies.team link works.

- [ ] **Drop photos in as they become available**

When photos arrive:
1. Put beat-1 photos into `assets/images/home/who/`.
2. Beat-2 photos into `assets/images/home/what/`.
3. Beat-3 photos into `assets/images/home/join/`.
4. Commit + push. Jekyll re-builds, photos appear, lightbox works.

No code changes needed after that — the template enumerates files automatically.

---

## Notes for the implementer

- No tests exist in this repo — verify visually.
- `dev-server.mjs` does not build Jekyll, so local home-page verification needs `bundle exec jekyll serve` (installs Ruby + Jekyll) OR relying on the Vercel preview URL. The admin pages still work via the dev server; only the home + any page using `{{ content }}` requires Jekyll.
- Existing hero is preserved — don't rewrite its core structure, just the description line in Task 6.
- Photo enumeration uses `site.static_files` filtered by path — works out of the box with default Jekyll config; no plugins needed.
- Keep the scoped `.beat-*` classes — other pages share the site stylesheet, so don't generalise selectors to `section` or `h2`.
- Maintain the existing CSS variable palette (`--accent`, `--bg`, etc.); no new custom colors.
