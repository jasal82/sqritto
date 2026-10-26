(function () {
  function split(el) {
    if (el.classList.contains('is-split')) return;
    var keys = (el.getAttribute('data-keys') || '').split('+').map(function (k) { return k.trim(); }).filter(Boolean);
    if (keys.length < 1) return;
    el.textContent = '';
    keys.forEach(function (k, i) {
      if (i) {
        var plus = document.createElement('span');
        plus.className = 'ts-keys__plus';
        plus.textContent = '+';
        plus.setAttribute('aria-hidden', 'true');
        el.appendChild(plus);
      }
      var kbd = document.createElement('kbd');
      kbd.textContent = k;
      el.appendChild(kbd);
    });
    el.classList.add('is-split');
  }
  function all() { document.querySelectorAll('.ts-keys[data-keys]').forEach(split); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', all);
  else all();
  document.addEventListener('ts:content', all);
})();
