(function () {
  var KEY = 'ts-tabs:';

  function panelsOf(root) {
    return Array.prototype.filter.call(root.children, function (el) {
      return el.classList.contains('ts-tab');
    });
  }

  function select(root, index, focus) {
    var list = root.querySelector('.ts-tabs__list');
    if (!list) return;
    var tabs = list.children;
    var panels = panelsOf(root);
    for (var i = 0; i < tabs.length; i++) {
      var on = i === index;
      tabs[i].setAttribute('aria-selected', on ? 'true' : 'false');
      tabs[i].tabIndex = on ? 0 : -1;
      if (panels[i]) panels[i].hidden = !on;
    }
    if (focus && tabs[index]) tabs[index].focus();
  }

  function syncGroup(group, label) {
    try { localStorage.setItem(KEY + group, label); } catch (e) {}
    document.querySelectorAll('.ts-tabs[data-group]').forEach(function (root) {
      if (root.getAttribute('data-group') !== group) return;
      panelsOf(root).forEach(function (p, i) {
        if (p.getAttribute('data-label') === label) select(root, i, false);
      });
    });
  }

  function init(root) {
    if (root.classList.contains('is-ready')) return;
    var panels = panelsOf(root);
    if (!panels.length) return;
    var list = document.createElement('div');
    list.className = 'ts-tabs__list';
    list.setAttribute('role', 'tablist');
    var group = root.getAttribute('data-group');
    panels.forEach(function (panel, i) {
      var id = 'ts-tab-' + Math.random().toString(36).slice(2, 9);
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ts-tabs__tab';
      btn.setAttribute('role', 'tab');
      btn.id = id + '-tab';
      btn.setAttribute('aria-controls', id);
      btn.textContent = panel.getAttribute('data-label') || 'Tab ' + (i + 1);
      panel.id = id;
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', btn.id);
      btn.addEventListener('click', function () {
        select(root, i, false);
        if (group) syncGroup(group, panel.getAttribute('data-label'));
      });
      list.appendChild(btn);
    });
    list.addEventListener('keydown', function (e) {
      var tabs = Array.prototype.slice.call(list.children);
      var cur = tabs.indexOf(document.activeElement);
      if (cur < 0) return;
      var next =
        e.key === 'ArrowRight' ? cur + 1 :
        e.key === 'ArrowLeft' ? cur - 1 :
        e.key === 'Home' ? 0 :
        e.key === 'End' ? tabs.length - 1 : null;
      if (next === null) return;
      e.preventDefault();
      select(root, (next + tabs.length) % tabs.length, true);
    });
    root.insertBefore(list, root.firstChild);
    root.classList.add('is-ready');
    var start = 0;
    if (group) {
      try {
        var saved = localStorage.getItem(KEY + group);
        panels.forEach(function (p, i) { if (p.getAttribute('data-label') === saved) start = i; });
      } catch (e) {}
    }
    select(root, start, false);
  }

  function all() { document.querySelectorAll('[data-ts-tabs]').forEach(init); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', all);
  else all();
  document.addEventListener('ts:content', all);
})();
