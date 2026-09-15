
(function() {
  var SUPPORTED = ['de', 'en', 'es', 'fr', 'it', 'sv', 'el', 'ru', 'tr', 'zh', 'ja', 'ar', 'hi', 'pt', 'uk', 'pl', 'nl', 'cs', 'vi', 'hu', 'ko', 'id', 'fa'];
  var STORAGE_KEY = 'aashiyana-locale';

  function resolve() {
    try {
      var stored = localStorage.getItem(STORAGE_KEY);
      if (stored && SUPPORTED.indexOf(stored) !== -1) return stored;
    } catch (e) { /* localStorage  */ }

    var browserLocales = navigator.languages || [navigator.language || ''];
    for (var i = 0; i < browserLocales.length; i++) {
      var base = String(browserLocales[i]).split('-')[0].toLowerCase();
      if (SUPPORTED.indexOf(base) !== -1) return base;
    }
    return 'en';
  }

  var locale = resolve();
  document.documentElement.lang = locale;
  document.documentElement.dir = (locale === 'ar' || locale === 'fa') ? 'rtl' : 'ltr';
})();
