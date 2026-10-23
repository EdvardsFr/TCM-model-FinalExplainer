/* =====================================================================
   UI: the light/dark switch and the "?" help icons
   ---------------------------------------------------------------------
   Needs draw.js ($). Load it after tabs.js in index.html.
   The page already redraws its canvases when data-theme changes (draw.js),
   so the switch only has to set the attribute and remember the choice.
   ===================================================================== */
'use strict';


/* =====================================================================
   1. LIGHT / DARK SWITCH
   Choice order: saved choice, else the system setting. The saved choice is
   applied by the small script in <head> (so the page does not flash).
   ===================================================================== */

const ICON_SVG = 'viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
const ICON_MOON = `<svg ${ICON_SVG}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>`;
const ICON_SUN  = `<svg ${ICON_SVG}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`;

const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

/** 'dark' or 'light': what the page looks like right now. */
const currentTheme = () => document.documentElement.dataset.theme || (systemDark.matches ? 'dark' : 'light');

/** The button shows what a click will switch to. */
function updateThemeButton() {
  const dark = currentTheme() === 'dark';
  const button = $('theme-toggle');
  button.innerHTML = dark ? ICON_SUN : ICON_MOON;
  button.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
  button.title = dark ? 'Light mode' : 'Dark mode';
}

$('theme-toggle').addEventListener('click', () => {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;       // style.css and draw.js react to this
  try { localStorage.setItem('theme', next); } catch (e) { /* storage blocked: still works, just not remembered */ }
  updateThemeButton();
});

systemDark.addEventListener('change', updateThemeButton);   // only matters until a choice is made
updateThemeButton();


/* =====================================================================
   2. HELP ICONS
   In HTML:   <span class="help" data-help="The explanation."></span>
   Hover or keyboard focus shows the text. For icons added later by script,
   call initHelp(container) after inserting them.
   The text box is positioned on the screen (position: fixed), so cards with
   overflow set cannot cut it off.
   ===================================================================== */


function initHelp(root = document) {
  root.querySelectorAll('.help[data-help]:not([data-ready])').forEach(box => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'help-btn';
    button.textContent = '?';

    const pop = document.createElement('span');
    pop.className = 'help-pop';
    pop.textContent = box.dataset.help;

    box.append(button, pop);
    box.dataset.ready = '1';

    // Position the tooltip below the icon.
    box.place = () => {
      pop.style.display = 'block';

      const b = button.getBoundingClientRect();
      const left = Math.max(
        8,
        Math.min(b.left, window.innerWidth - 8 - pop.offsetWidth)
      );

      pop.style.left = left + 'px';
      pop.style.top = (b.bottom + 8) + 'px';
      pop.style.display = '';
    };

    button.addEventListener('mouseenter', () => box.place());
    button.addEventListener('focus', () => box.place());
  });
}

initHelp();