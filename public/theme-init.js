// Einmalige, idempotente Migration aller Legacy-„oikos"-Storage-Keys → „aashiyana".




(function migrateLegacyStorage() {




  try {
    var stores = [localStorage, sessionStorage];
    for (var s = 0; s < stores.length; s++) {
      var store = stores[s];
      var keys = [];
      for (var i = 0; i < store.length; i++) {
        var k = store.key(i);
        if (k && /^oikos[-:.]/.test(k)) keys.push(k);
      }
      for (var j = 0; j < keys.length; j++) {
        var oldKey = keys[j];
        var newKey = 'aashiyana' + oldKey.slice('oikos'.length);
        if (store.getItem(newKey) === null) {
          store.setItem(newKey, store.getItem(oldKey));
        }
        store.removeItem(oldKey);
      }
    }
  } catch (e) { /* Storage nicht verfügbar (Privatmodus) → ignorieren */ }
})();

(function() {
  var stored = localStorage.getItem('aashiyana-theme');
  if (stored === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else if (stored === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }


  //
  // Beide `<meta name="theme-color">` tragen ein `media="(prefers-color-scheme:






  // Quelle.
  //




  //



  try {
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    if (metas.length >= 2 && (stored === 'dark' || stored === 'light')) {
      var active = metas[stored === 'dark' ? 1 : 0].getAttribute('content');
      metas[0].setAttribute('content', active);
      metas[1].setAttribute('content', active);
    }
  } catch (e) { /* ohne Metas bleibt es beim Systemverhalten */ }
})();


//





// Anfangszustand.
//



// in test-frontend-audit.js.
(function () {
  try {
    if (localStorage.getItem('aashiyana-wall-mode') !== '1') return;
    if (location.pathname !== '/') return;
    document.documentElement.setAttribute('data-wall-mode', '');
    var hour = new Date().getHours();
    if (hour >= 22 || hour < 6) {
      document.documentElement.setAttribute('data-wall-night', '');
      // Nachts erzwungen dunkel - ohne `aashiyana-theme` anzufassen.
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  } catch (e) { /* Storage nicht verfuegbar → kein Wand-Modus in dieser Sitzung */ }
})();
