/* =====================================================================
   DRAW: canvas helpers shared by the explainer demos and the sandbox
   ---------------------------------------------------------------------
   Load order in index.html:  tcm.js -> draw.js -> explainer.js -> sandbox.js
   (tcm.js is the model and has no DOM code. This file draws it.)

   Sections:
     1. Shared names        (pulled out of TCM once, used by every file)
     2. Layout and colours
     3. Canvas drawing      (setup, vectors, reinstatement chart)
     4. Redraw registry     (theme / resize handling for every canvas)
   ===================================================================== */
'use strict';


/* =====================================================================
   1. SHARED NAMES
   ===================================================================== */

const { DIM, FEATURES, FEATURE_SHORT, WORDS, RACE, NEEDED, dot, mean } = TCM;

const $ = id => document.getElementById(id);

/** Two decimals, without a confusing "-0.00" for values that are really zero. */
const num2 = v => (Math.abs(v) < 0.005 ? 0 : v).toFixed(2);


/* =====================================================================
   2. LAYOUT AND COLOURS
   ===================================================================== */

/** Canvas layout, in CSS pixels. */
const LAYOUT = {
  labelWidth: 70,      // word labels in the heatmaps
  matrixRow: 14,       // row height: association matrix and drift heatmap
  raceRow: 20,         // row height: retrieval race
  stripBlock: 44,      // height of one labelled vector strip
  reinstateRow: 20,    // row height: before/after bars in the reinstatement chart
};

/** Colours used on the canvases (the page's own text colour is read from CSS). */
const COLORS = {
  positive: [47, 111, 237],   // blue cells
  negative: [230, 126, 34],   // orange cells
  blue: '#2f6fed',
  green: '#1f9d63',
  orange: '#e67e22',
  grey: '#99a1b3',
  frame: 'rgba(128,128,128,.4)',
  track: 'rgba(128,128,128,.2)',
};


/* =====================================================================
   3. CANVAS DRAWING
   ===================================================================== */

/** Resize a canvas (element or id) for the screen's pixel density; returns [ctx, width, height]. */
function setupCanvas(target) {
  const canvas = typeof target === 'string' ? $(target) : target;
  const ratio = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = w * ratio;
  canvas.height = h * ratio;
  const g = canvas.getContext('2d');
  g.setTransform(ratio, 0, 0, ratio, 0, 0);
  return [g, w, h];
}

const textColor = () => getComputedStyle(document.body).color;

/** Blue for positive values, orange for negative; `scale` boosts faint values. */
function cellColor(value, scale) {
  const [r, g, b] = value >= 0 ? COLORS.positive : COLORS.negative;
  return `rgba(${r},${g},${b},${Math.min(1, Math.abs(value) * scale)})`;
}

/** Draw a vector as a row of coloured cells. */
function drawVector(g, vec, x, y, w, h, scale) {
  const cellW = w / DIM;
  for (let i = 0; i < DIM; i++) {
    g.fillStyle = cellColor(vec[i], scale);
    g.fillRect(x + i * cellW, y, cellW + 0.5, h);
  }
  g.strokeStyle = COLORS.frame;
  g.strokeRect(x, y, w, h);
}

/** Canvas height the reinstatement chart needs for n words. */
const reinstateHeight = n => 3 * LAYOUT.stripBlock + 30 + n * LAYOUT.reinstateRow;

/**
 * Reinstatement chart: what a recall did to the context.
 *   target  canvas element or id
 *   ev      the record returned by World.recall / World.stepTest, or null
 *   items   world.items  ([{ word, memory }])
 * Top: context before, the recalled word's stored context, context after.
 * Bottom: every word's accessibility before (grey) and after (green).
 * The orange line is roughly the accessibility a word needs to win the race.
 */
function drawReinstatementChart(target, ev, items, emptyMessage) {
  const [g, w] = setupCanvas(target);
  g.font = '12px system-ui';
  g.fillStyle = textColor();

  if (!ev) {
    g.fillText(emptyMessage || 'Nothing recalled yet.', 0, 14);
    return;
  }

  const item = items[ev.item];
  const strips = [
    [ev.before,   `Context before recall #${ev.rank}   overlap with "${item.word}": ${num2(dot(ev.before, item.memory))}`],
    [item.memory, `Stored context of "${item.word}" (the word just recalled)`],
    [ev.after,    `Context after reinstatement   overlap with "${item.word}": ${num2(dot(ev.after, item.memory))}`],
  ];
  strips.forEach(([vec, label], r) => {
    const y = r * LAYOUT.stripBlock;
    g.fillStyle = textColor();
    g.fillText(label, 0, y + 11);
    drawVector(g, vec, 0, y + 16, w, 22, 5);
  });

  // Heading and legend for the bars.
  const top = 3 * LAYOUT.stripBlock + 8;
  g.fillStyle = textColor();
  g.fillText('Accessibility:', 0, top + 10);
  g.fillStyle = COLORS.grey;   g.fillText('■ before', 90, top + 10);
  g.fillStyle = COLORS.green;  g.fillText('■ after', 160, top + 10);
  g.fillStyle = COLORS.orange; g.fillText('| needed to win', 220, top + 10);

  // Bars.
  const left = 90, valueW = 90, barW = Math.max(40, w - left - valueW);
  const rowsTop = top + 20;
  const maxV = Math.max(0.5, ...ev.driveBefore, ...ev.driveAfter);
  const xOf = v => left + Math.min(1, v / maxV) * barW;

  items.forEach((it, i) => {
    const y = rowsTop + i * LAYOUT.reinstateRow;
    const done = ev.recalled.includes(i);
    g.globalAlpha = done ? 0.4 : 1;

    g.fillStyle = textColor();
    g.fillText((done ? '✓ ' : '') + it.word, 0, y + 11);
    g.fillStyle = COLORS.track;
    g.fillRect(left, y + 2, barW, LAYOUT.reinstateRow - 4);
    g.fillStyle = COLORS.grey;
    g.fillRect(left, y + 3, xOf(ev.driveBefore[i]) - left, 6);
    g.fillStyle = COLORS.green;
    g.fillRect(left, y + 10, xOf(ev.driveAfter[i]) - left, 6);

    g.fillStyle = textColor();
    g.fillText(`${num2(ev.driveBefore[i])} → ${num2(ev.driveAfter[i])}`, left + barW + 8, y + 11);
    g.globalAlpha = 1;
  });

  g.strokeStyle = COLORS.orange;
  g.beginPath();
  g.moveTo(xOf(NEEDED), rowsTop);
  g.lineTo(xOf(NEEDED), rowsTop + items.length * LAYOUT.reinstateRow);
  g.stroke();
}


/* =====================================================================
   4. REDRAW REGISTRY
   Every canvas-drawing piece registers a function here. They all run again
   when the window resizes or the colour theme changes.
   ===================================================================== */

const redrawHooks = [];
const onRedraw = fn => redrawHooks.push(fn);

let redrawQueued = false;
function redrawAll() {
  if (redrawQueued) return;
  redrawQueued = true;
  requestAnimationFrame(() => {
    redrawQueued = false;
    redrawHooks.forEach(fn => fn());
  });
}

window.addEventListener('resize', redrawAll);
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', redrawAll);
new MutationObserver(redrawAll).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
