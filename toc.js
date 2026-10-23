/* =====================================================================
   TOC: the chapter list beside the explainer
   ---------------------------------------------------------------------
   Needs draw.js ($). Load it after ui.js in index.html.
   Every <section id="part-..."> in the explainer becomes one link. The
   label is the section's small "step" line (for example "3 · Drift"), or
   its <h2> if it has none. Add a section and it shows up by itself.
   The chapter you are reading is marked as you scroll.
   ===================================================================== */
'use strict';

function buildToc() {
  const list = $('toc-list');
  const sections = [...document.querySelectorAll('#panel-explainer section[id^="part-"]')];

  sections.forEach(section => {
    const label = (section.querySelector('.step') || section.querySelector('h2')).textContent.trim();
    const link = document.createElement('a');
    link.href = '#' + section.id;
    link.textContent = label;
    const item = document.createElement('li');
    item.append(link);
    list.append(item);
  });

  /** Mark one chapter as the current one. */
  function setCurrent(id) {
    list.querySelectorAll('a').forEach(link => {
      if (link.getAttribute('href') === '#' + id) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    });
  }

  // The current chapter is the one crossing a band near the top of the window.
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => { if (entry.isIntersecting) setCurrent(entry.target.id); });
  }, { rootMargin: '-15% 0px -75% 0px' });
  sections.forEach(section => observer.observe(section));

  list.addEventListener('click', e => {
    const link = e.target.closest('a');
    if (link) setCurrent(link.getAttribute('href').slice(1));
  });
}

buildToc();