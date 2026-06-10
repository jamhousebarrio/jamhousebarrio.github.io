/* Minimal EN/ES toggle for the PUBLIC pages (homepage + apply).
 *
 * Usage: the page defines `window.I18N = { en: {...}, es: {...} }` BEFORE
 * including this script (load both near the end of <body> so the DOM exists).
 *
 * - Elements with data-i18n="key" get the dict value via innerHTML. The dict
 *   is fully static, author-controlled copy (some entries contain links) —
 *   NEVER route user input through it.
 * - Elements with data-i18n-placeholder="key" get the placeholder attribute.
 * - Buttons with data-lang-btn="en|es" switch language; the current one gets
 *   the .active class.
 * - Language resolution on load: ?lang=es|en param > localStorage('jh_lang')
 *   > 'en'. Whatever wins is persisted, so the choice follows across pages.
 * - <html lang> is kept in sync ('es' / 'en-GB').
 *
 * window.JHI18N = { t(key), setLang(lang), lang, refresh() } for inline
 * scripts that need translated strings at runtime (e.g. error messages).
 */
(function () {
  var DICT = window.I18N || { en: {}, es: {} };
  var lang = 'en';

  function t(key) {
    var d = DICT[lang] || {};
    if (key in d) return d[key];
    var en = DICT.en || {};
    return key in en ? en[key] : key;
  }

  function refresh() {
    document.documentElement.lang = lang === 'es' ? 'es' : 'en-GB';
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var val = t(el.getAttribute('data-i18n'));
      if (val != null) el.innerHTML = val; // static author-controlled HTML only
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
      var val = t(el.getAttribute('data-i18n-placeholder'));
      if (val != null) el.setAttribute('placeholder', val);
    });
    document.querySelectorAll('[data-lang-btn]').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-lang-btn') === lang);
    });
  }

  function setLang(l) {
    lang = l === 'es' ? 'es' : 'en';
    try { localStorage.setItem('jh_lang', lang); } catch (e) { /* private mode */ }
    refresh();
  }

  var param = new URLSearchParams(location.search).get('lang');
  var stored = null;
  try { stored = localStorage.getItem('jh_lang'); } catch (e) { /* private mode */ }
  var initial = (param === 'es' || param === 'en') ? param
    : (stored === 'es' || stored === 'en') ? stored
    : 'en';
  setLang(initial);

  document.querySelectorAll('[data-lang-btn]').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      setLang(btn.getAttribute('data-lang-btn'));
    });
  });

  window.JHI18N = {
    t: t,
    setLang: setLang,
    refresh: refresh,
    get lang() { return lang; }
  };
})();
