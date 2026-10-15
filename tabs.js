/* =====================================================================
   TABS: switch between the explainer and the model
   ---------------------------------------------------------------------
   Needs draw.js ($ and redrawAll). Load it last in index.html.
   The page is two panels, #panel-explainer and #panel-model, and two
   buttons, #tab-explainer and #tab-model. The URL hash remembers the tab
   (index.html#model opens the model).
   ===================================================================== */
'use strict';

const TAB_NAMES = ['explainer', 'model'];   // the first one is the default

function showTab(name) {
  if (!TAB_NAMES.includes(name)) name = TAB_NAMES[0];

  TAB_NAMES.forEach(n => {
    const selected = n === name;
    $('panel-' + n).hidden = !selected;
    $('tab-' + n).setAttribute('aria-selected', selected);
    $('tab-' + n).tabIndex = selected ? 0 : -1;
  });

  try {   // some embeds do not allow changing the address; the tabs still work
    history.replaceState(null, '', name === TAB_NAMES[0] ? location.pathname + location.search : '#' + name);
  } catch (e) { /* ignore */ }

  window.scrollTo(0, 0);
  redrawAll();   // canvases have no size while hidden, so draw them again now
}

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => showTab(tab.dataset.tab));
  tab.addEventListener('keydown', e => {          // left / right arrows move between tabs
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const next = TAB_NAMES[(TAB_NAMES.indexOf(tab.dataset.tab) + 1) % TAB_NAMES.length];
    showTab(next);
    $('tab-' + next).focus();
  });
});

window.addEventListener('hashchange', () => {
  if (TAB_NAMES.includes(location.hash.slice(1))) showTab(location.hash.slice(1));
});

showTab(location.hash.slice(1));   // open the tab named in the URL, otherwise the explainer