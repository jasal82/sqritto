(function () {
  // Beschriftungen nach Dokumentsprache (<html lang>): Deutsch, sonst Englisch.
  var lang = (document.documentElement.getAttribute('lang') || 'de').toLowerCase();
  var de = lang === 'de' || lang.indexOf('de-') === 0;
  var L = de
    ? { notes: 'Fußnoten', note: 'Fußnote ', back: 'Zurück zum Text' }
    : { notes: 'Footnotes', note: 'Footnote ', back: 'Back to text' };

  function init() {
    var article = document.querySelector('.ts-article');
    if (!article) return;
    var old = article.querySelector('.ts-footnotes');
    if (old) old.remove();
    var notes = article.querySelectorAll('[data-ts-footnote]');
    if (!notes.length) return;
    var section = document.createElement('section');
    section.className = 'ts-footnotes';
    section.setAttribute('aria-label', L.notes);
    var ol = document.createElement('ol');
    notes.forEach(function (fn, i) {
      var n = i + 1;
      var ref = fn.querySelector('.ts-fn__ref');
      var body = fn.querySelector('.ts-fn__body');
      if (!ref || !body) return;
      ref.textContent = String(n);
      ref.id = 'ts-fnref-' + n;
      ref.setAttribute('aria-label', L.note + n);
      ref.onclick = function (e) {
        e.stopPropagation();
        var open = !fn.classList.contains('is-open');
        document.querySelectorAll('.ts-fn.is-open').forEach(function (o) { o.classList.remove('is-open'); });
        fn.classList.toggle('is-open', open);
        ref.setAttribute('aria-expanded', open ? 'true' : 'false');
      };
      var li = document.createElement('li');
      li.id = 'ts-fn-' + n;
      li.innerHTML = body.innerHTML;
      var back = document.createElement('a');
      back.href = '#ts-fnref-' + n;
      back.className = 'ts-fn-back';
      back.setAttribute('aria-label', L.back);
      back.textContent = '↩';
      li.appendChild(back);
      ol.appendChild(li);
    });
    section.appendChild(ol);
    article.appendChild(section);
  }
  document.addEventListener('click', function () {
    document.querySelectorAll('.ts-fn.is-open').forEach(function (o) { o.classList.remove('is-open'); });
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  document.addEventListener('ts:content', init);
})();
