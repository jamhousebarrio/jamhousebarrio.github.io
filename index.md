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
