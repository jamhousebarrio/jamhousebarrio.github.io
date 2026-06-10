---
layout: default
title: JamHouse 2026
body_class: page-home
---

<!-- Translatable copy is keyed with data-i18n; the EN/ES dict lives in
     _layouts/default.html (window.I18N) and is applied by /assets/js/i18n.js.
     If you edit text here, update BOTH en + es entries in the dict too. -->

<section class="beat beat-left" id="beat-who">
  <div class="beat-text">
    <h2 data-i18n="whoTitle">Who we are</h2>
    <p data-i18n="whoP1">JamHouse is a barrio of musicians and music lovers at <a href="https://nobodies.team">Elsewhere</a>, now in our 3rd year on the playa. We come from all over the world — artists, engineers, chefs, wanderers — an international mix that speaks the shared language of music.</p>
    <p data-i18n="whoP2">Some of us are seasoned musicians, some are honorable groupies. What unites us is how much we love the music.</p>
  </div>
  <div class="beat-photos">
    {% for photo in site.data.home_photos.who %}
      <img src="{{ photo }}" alt="JamHouse moment" loading="lazy" class="beat-photo">
    {% endfor %}
  </div>
</section>

<section class="beat beat-right" id="beat-what">
  <div class="beat-text">
    <h2 data-i18n="whatTitle">What happens here</h2>
    <ul class="beat-list">
      <li data-i18n="whatLi1">Open stages and impromptu jam sessions</li>
      <li data-i18n="whatLi2">Shared instruments — amps, drums, guitars, mics</li>
      <li data-i18n="whatLi3">Group singalongs under the desert sky</li>
      <li data-i18n="whatLi4">Tasty meals and cold drinks</li>
      <li data-i18n="whatLi5">A shower with actual good pressure</li>
      <li data-i18n="whatLi6">A shaded, welcoming home on the playa</li>
      <li data-i18n="whatLi7">Kind, supportive people who've got your back</li>
    </ul>
  </div>
  <div class="beat-photos">
    {% for photo in site.data.home_photos.what %}
      <img src="{{ photo }}" alt="JamHouse moment" loading="lazy" class="beat-photo">
    {% endfor %}
  </div>
</section>

<section class="beat beat-left" id="beat-join">
  <div class="beat-text">
    <h2 data-i18n="joinTitle">Come join us</h2>
    <p data-i18n="joinP1">We're looking for people who want to be part of JamHouse for 2026. Musicians and non-musicians welcome — we need builders, cooks, and good energy just as much as we need guitar players.</p>
    <p><a href="/apply" class="beat-cta" data-i18n="joinCta">Apply for Membership</a></p>
    <p class="beat-footnote" data-i18n="joinFootnote">JamHouse is part of <a href="https://nobodies.team">Elsewhere 2026</a> — a participatory burn event in the Aragon desert, July 2026.</p>
  </div>
  <div class="beat-photos">
    {% for photo in site.data.home_photos.join %}
      <img src="{{ photo }}" alt="JamHouse moment" loading="lazy" class="beat-photo">
    {% endfor %}
  </div>
</section>
