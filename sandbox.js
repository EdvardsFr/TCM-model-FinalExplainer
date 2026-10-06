/* =====================================================================
   SANDBOX: the full model with every control
   ---------------------------------------------------------------------
   Needs tcm.js (the model) and draw.js (shared drawing helpers).
   This file is only the interface: it reads the controls, calls the
   World, and draws the result.

   Sections:
     1. Configuration        <- sliders and study-grid presets
     2. State and control readers
     3. Actions              (study, wait, test)
     4. Drawing              (one function per panel)
     5. UI construction      (sliders, feature table, study grid)
     6. Event wiring and startup
   ===================================================================== */
'use strict';


/* =====================================================================
   1. CONFIGURATION
   ===================================================================== */

/**
 * Sliders. `id` is the key in world.params, except `items` (list length,
 * which only the interface uses).
 */
const SLIDERS = [
  { id: 'items',        label: 'List length (max words)',                  min: 4,    max: 12,   step: 1,     value: 8    },
  { id: 'encDrift',     label: 'Encoding drift β (per studied word)', min: 0.1,  max: 0.9,  step: 0.05,  value: 0.6  },
  { id: 'waitDrift',    label: 'Drift per event β',                   min: 0.05, max: 0.9,  step: 0.05,  value: 0.45 },
  { id: 'reinstate',    label: 'Reinstatement β',                     min: 0,    max: 0.9,  step: 0.05,  value: 0.5  },
  { id: 'featStrength', label: 'Feature strength',                         min: 0,    max: 2,    step: 0.1,   value: 1    },
  { id: 'cueWeight',    label: 'Cue weight',                               min: 0,    max: 3,    step: 0.1,   value: 1.5  },
  { id: 'noise',        label: 'Noise',                                    min: 0,    max: 1,    step: 0.05,  value: 0.3  },
  { id: 'competition',  label: 'Competition',                              min: 0,    max: 0.4,  step: 0.02,  value: 0.1  },
  { id: 'decay',        label: 'True trace decay / event',                 min: 0,    max: 0.05, step: 0.005, value: 0    },
];

/** How many race steps run per animation frame (the test's playback speed). */
const STEPS_PER_FRAME = 6;

/** Study-grid presets: return true if feature k is present for item i of n. */
const PRESETS = {
  same:   (i, k, n) => k === 0 || k === 3,                        // Place A + song
  split:  (i, k, n) => k === 3 || k === (i < n / 2 ? 0 : 1),      // song + (A first half, B second)
  none:   () => false,                                            // nothing shared
  random: () => Math.random() < 0.35,
};


/* =====================================================================
   2. STATE AND CONTROL READERS
   ===================================================================== */

const world = new TCM.World(7);

const state = {
  selected: 0,      // item shown in the context strips
  test: null,       // running / paused / finished test (from world.startTest), or null
  lastRecall: null, // record of the most recent recall (for the reinstatement panel)
};

/** Value of a slider by id. */
const param = id => +$(id).value;

/** Is a checkbox ticked? */
const checked = id => $(id).checked;

/** Flags (one boolean per feature) for the words, the wait period, and the cue. */
const studyFlags = i => FEATURES.map((_, k) => checked(`study-${i}-${k}`));
const waitFlags  = () => FEATURES.map((_, k) => checked(`wait-${k}`));
const cueFlags   = () => FEATURES.map((_, k) => checked(`cue-${k}`));

/** The context the model is "in" right now: the test context while testing. */
const activeContext = () => (state.test ? state.test.context : world.context);

/** Copy every slider except list length into the world's parameters. */
function syncParams() {
  SLIDERS.forEach(s => { if (s.id !== 'items') world.params[s.id] = param(s.id); });
}


/* =====================================================================
   3. ACTIONS
   ===================================================================== */

/** Restart with no words studied. */
function resetEmpty() {
  syncParams();
  world.reset(+$('seed').value || 1);
  state.selected = 0;
  state.test = null;
  state.lastRecall = null;
  sizeCanvases();
  redraw();
}

/** Study one more word (uses the next row of the study grid). */
function studyNext() {
  const i = world.items.length;
  if (i >= param('items')) return;
  syncParams();
  state.test = null;
  state.lastRecall = null;
  world.encode(studyFlags(i), WORDS[i]);
  sizeCanvases();
  redraw();
}

/** Restart the world and study the whole list at once. */
function studyAll() {
  resetEmpty();
  while (world.items.length < param('items')) {
    const i = world.items.length;
    world.encode(studyFlags(i), WORDS[i]);
  }
  sizeCanvases();
  redraw();
}

/** Let `count` distractor events happen. Ticked "wait" features recur in each. */
function addEvents(count) {
  syncParams();
  state.test = null;
  state.lastRecall = null;
  world.wait(count, waitFlags());
  redraw();
}

/** Begin a recall test from the current context. */
function startTest() {
  if (!world.items.length) return;
  syncParams();
  state.lastRecall = null;
  state.test = world.startTest(cueFlags());
  redraw();
}

/** Resume a test that paused after a recall. */
function continueTest() {
  const T = state.test;
  if (!T || !T.paused) return;
  T.paused = false;
  redraw();
}

/** End the test now, wherever it is. */
function stopTest() {
  const T = state.test;
  if (!T || T.over) return;
  T.over = true;
  T.paused = false;
  redraw();
}

/**
 * One step of the retrieval race. If a word wins, keep the record of what
 * its recall did to the context, and pause if the box is ticked.
 */
function stepRace() {
  const T = state.test;
  if (!T || T.over || T.paused) return;

  T.cueFlags = cueFlags();                   // cue ticks can change mid-test
  const record = world.stepTest(T);
  if (record) {
    state.lastRecall = record;
    if (!T.over && checked('pause-on-recall')) T.paused = true;
    redraw();
  } else if (T.over) {
    redraw();
  }
}


/* =====================================================================
   4. DRAWING
   ===================================================================== */

/** Heights of the canvases that depend on the number of items. */
function sizeCanvases() {
  const n = world.items.length;
  $('cv-matrix').style.height = n * LAYOUT.matrixRow + 'px';
  $('cv-drift').style.height = n * LAYOUT.matrixRow + 'px';
  $('cv-race').style.height = n * LAYOUT.raceRow + 'px';
  $('cv-reinstate').style.height = reinstateHeight(n) + 'px';
}

/** Enable/disable buttons, label "Study next", and mark rows of the study grid. */
function updateControls() {
  const T = state.test;
  const studied = world.items.length, max = param('items');
  const full = studied >= max;

  $('btn-study-next').textContent = full ? 'List is full (press Reset)' : `Study next: ${WORDS[studied]}`;
  $('btn-study-next').disabled = full;
  $('btn-continue').disabled = !(T && T.paused);
  $('btn-stop').disabled = !(T && !T.over);

  document.querySelectorAll('#study-grid tr[data-row]').forEach(row => {
    const i = +row.dataset.row;
    row.classList.toggle('done', i < studied);
    row.classList.toggle('next', i === studied);
  });
}

/** Memory chips: click to select; green + number once recalled. */
function drawChips() {
  const T = state.test;
  $('chips').innerHTML = world.items.map((item, i) => {
    const rank = T ? T.recalled.indexOf(i) : -1;
    const cls = ['chip', i === state.selected ? 'selected' : '', rank >= 0 ? 'recalled' : ''].join(' ');
    return `<button class="${cls}" data-index="${i}">${rank >= 0 ? (rank + 1) + '. ' : ''}${item.word}</button>`;
  }).join('');
}

/** The three bars and the status line. */
function drawMeters() {
  const { items } = world;
  const T = state.test;
  const n = items.length;

  if (!n) {
    ['stored', 'nocue', 'cued'].forEach(name => {
      $(`bar-${name}`).style.width = '0%';
      $(`val-${name}`).textContent = '';
    });
    $('caption').innerHTML = 'No words studied yet. Press <b>Study next</b> to encode the first word.';
    return;
  }

  const m = world.meters(activeContext(), cueFlags());
  [['stored', m.stored], ['nocue', m.nocue], ['cued', m.cued]].forEach(([name, v]) => {
    $(`bar-${name}`).style.width = Math.min(100, v * 100) + '%';
    $(`val-${name}`).textContent = Math.floor(v * 100) + '%';
  });

  const eventsSinceStudy = world.now - items[n - 1].index;
  if (T && T.over) {
    const missing = T.recalled.length < n ? ', so what is missing is access, not storage.' : '.';
    $('caption').innerHTML =
      `Test finished: recalled <b>${T.recalled.length}/${n}</b> ${T.cued ? 'with' : 'without'} cues ` +
      `${eventsSinceStudy} events after the last word. Traces remain ${Math.floor(m.stored * 100)}% intact${missing}`;
  } else if (T && T.paused) {
    const ev = state.lastRecall;
    $('caption').innerHTML =
      `Paused after recall #${ev.rank}: <b>${items[ev.item].word}</b>. Its stored context was blended into the ` +
      `test context. Press <b>Continue</b> to see what the new context favours.`;
  } else if (T) {
    $('caption').textContent = 'Racing...';
  } else {
    $('caption').innerHTML = `${n} word${n > 1 ? 's' : ''} studied, ${eventsSinceStudy} events since the last one. Press <b>Start test</b>.`;
  }
}

/** Strips: stored context of the selected item, current (or test) context, cue. */
function drawStrips() {
  const [g, w] = setupCanvas('cv-strips');
  const T = state.test;
  const ctx = activeContext();
  const item = world.items[state.selected];

  const rows = [];
  if (item) rows.push([item.memory, `Stored context of "${item.word}"`, false]);
  rows.push([ctx, T ? 'Test context (changes whenever a word is recalled)' : 'Current context', true]);
  rows.push([world.cueFor(ctx, cueFlags()), 'Retrieval cue (context + chosen features)', true]);

  g.font = '12px system-ui';
  rows.forEach(([vec, label, showOverlap], r) => {
    const y = r * LAYOUT.stripBlock;
    const overlap = item && showOverlap ? `   overlap with stored: ${num2(dot(item.memory, vec))}` : '';
    g.fillStyle = textColor();
    g.fillText(label + overlap, 0, y + 11);
    drawVector(g, vec, 0, y + 16, w, 22, 5);
  });
}

/** Association matrix: one stored context per row. */
function drawMatrix() {
  const [g, w] = setupCanvas('cv-matrix');
  g.font = '11px system-ui';
  world.items.forEach((item, i) => {
    drawVector(g, item.memory, LAYOUT.labelWidth, i * LAYOUT.matrixRow, w - LAYOUT.labelWidth, 12, 5);
    g.fillStyle = textColor();
    g.fillText(item.word, 0, i * LAYOUT.matrixRow + 10);
  });
}

/** Drift heatmap: accessibility of each item from the context at every event. */
function drawDrift() {
  const [g, w, h] = setupCanvas('cv-drift');
  if (!world.items.length) return;
  const events = world.history.length;
  const cellW = (w - LAYOUT.labelWidth) / events;
  g.font = '11px system-ui';

  world.items.forEach((item, i) => {
    g.fillStyle = textColor();
    g.fillText(item.word, 0, i * LAYOUT.matrixRow + 10);
    for (let t = item.index; t < events; t++) {
      g.fillStyle = cellColor(world.accessibility(i, world.history[t].context, null, t), 1.3);
      g.fillRect(LAYOUT.labelWidth + t * cellW, i * LAYOUT.matrixRow, cellW + 0.5, 13);
    }
  });

  // Outline the span since the first word was studied.
  const first = world.items[0].index;
  g.strokeStyle = COLORS.orange;
  g.strokeRect(LAYOUT.labelWidth + first * cellW, 0, (events - first) * cellW, h);
}

/** Retrieval race: one bar per item; orange line = threshold. */
function drawRace() {
  const [g, w, h] = setupCanvas('cv-race');
  const T = state.test;
  if (!world.items.length) return;
  const rowH = h / world.items.length;
  const left = 80, barW = w - left - 8;

  g.font = '12px system-ui';
  g.textBaseline = 'middle';

  world.items.forEach((item, i) => {
    const y = i * rowH;
    const rank = T ? T.recalled.indexOf(i) : -1;
    const x = T ? T.activation[i] : 0;

    g.fillStyle = textColor();
    g.fillText(item.word, 0, y + rowH / 2);
    g.fillStyle = COLORS.track;
    g.fillRect(left, y + 4, barW, rowH - 8);

    g.fillStyle = rank >= 0 ? COLORS.green : COLORS.blue;
    const fill = rank >= 0 ? barW : Math.min(1, x / (2 * RACE.threshold)) * barW;
    g.fillRect(left, y + 4, fill, rowH - 8);

    if (rank >= 0) {
      g.fillStyle = '#fff';
      g.fillText('recalled #' + (rank + 1), left + 6, y + rowH / 2);
    }
  });

  // Threshold sits at the middle of each bar.
  g.strokeStyle = COLORS.orange;
  g.beginPath(); g.moveTo(left + barW / 2, 0); g.lineTo(left + barW / 2, h); g.stroke();
}

/** Reinstatement panel: see drawReinstatementChart in draw.js. */
function drawReinstatement() {
  drawReinstatementChart('cv-reinstate', state.lastRecall, world.items,
                         'Nothing recalled yet. Start a test: each recalled word will show up here.');
}

/** Redraw every panel. */
function redraw() {
  updateControls();
  drawChips();
  drawMeters();
  drawStrips();
  drawMatrix();
  drawDrift();
  drawRace();
  drawReinstatement();
}


/* =====================================================================
   5. UI CONSTRUCTION
   ===================================================================== */

function buildSliders() {
  $('sliders').innerHTML = SLIDERS.map(s => `
    <label>${s.label}<output id="out-${s.id}">${s.value}</output></label>
    <input type="range" id="${s.id}" min="${s.min}" max="${s.max}" step="${s.step}" value="${s.value}">
  `).join('');
}

/** One row per feature: tick "wait" (present during wait & test) and "cue". */
function buildFeatureTable() {
  FEATURES.forEach((name, k) => {
    $('feature-table').insertAdjacentHTML('beforeend', `
      <tr>
        <td>${name}</td>
        <td><input type="checkbox" id="wait-${k}" aria-label="${name} present during wait and test"></td>
        <td><input type="checkbox" id="cue-${k}" aria-label="Use ${name} as cue"></td>
      </tr>`);
  });
}

/** One row per word, one checkbox per feature. Ticks survive a change in list length. */
function buildStudyGrid() {
  const n = param('items');
  const previous = {};
  document.querySelectorAll('#study-grid input').forEach(box => { previous[box.id] = box.checked; });

  const header = FEATURE_SHORT.map((s, k) => `<th title="${FEATURES[k]}">${s}</th>`).join('');
  const rows = Array.from({ length: n }, (_, i) => {
    const cells = FEATURES.map((name, k) => {
      const id = `study-${i}-${k}`;
      const on = id in previous ? previous[id] : PRESETS.same(i, k, n);
      return `<td><input type="checkbox" id="${id}" aria-label="${WORDS[i]} studied with ${name}" ${on ? 'checked' : ''}></td>`;
    }).join('');
    return `<tr data-row="${i}"><td>${WORDS[i]}</td>${cells}</tr>`;
  }).join('');

  $('study-grid').innerHTML = `<table><tr><th></th>${header}</tr>${rows}</table>`;
}

function applyPreset(name) {
  const n = param('items');
  for (let i = 0; i < n; i++) {
    FEATURES.forEach((_, k) => { $(`study-${i}-${k}`).checked = PRESETS[name](i, k, n); });
  }
}


/* =====================================================================
   6. EVENT WIRING AND STARTUP
   ===================================================================== */

function wireEvents() {
  // Build the memory
  $('btn-study-next').onclick = studyNext;
  $('btn-study-all').onclick = studyAll;
  $('btn-reset').onclick = resetEmpty;
  $('btn-random-seed').onclick = () => { $('seed').value = Math.floor(Math.random() * 9999); resetEmpty(); };

  // Let time pass
  $('btn-wait-1').onclick = () => addEvents(1);
  $('btn-wait-5').onclick = () => addEvents(5);
  $('btn-wait-20').onclick = () => addEvents(20);

  // Test recall
  $('btn-test').onclick = startTest;
  $('btn-continue').onclick = continueTest;
  $('btn-stop').onclick = stopTest;

  SLIDERS.forEach(s => {
    $(s.id).oninput = () => {
      $('out-' + s.id).textContent = $(s.id).value;
      if (s.id === 'items') buildStudyGrid();
      else world.params[s.id] = param(s.id);     // takes effect immediately
      redraw();
    };
  });

  document.querySelectorAll('[data-preset]').forEach(btn => {
    btn.onclick = () => applyPreset(btn.dataset.preset);
  });

  $('chips').addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    state.selected = +chip.dataset.index;
    redraw();
  });

  // Any checkbox change in the model (wait/cue features) updates the panels at once.
  document.addEventListener('change', e => {
    if (e.target.closest('#model') && e.target.type === 'checkbox') redraw();
  });

  onRedraw(redraw);   // resize and theme changes (draw.js)
}

/** Animation loop: advance a running test a few steps per frame. */
function loop() {
  const T = state.test;
  if (T && !T.over && !T.paused) {
    for (let i = 0; i < STEPS_PER_FRAME && !T.over && !T.paused; i++) stepRace();
    if (!T.over && !T.paused) drawRace();
  }
  requestAnimationFrame(loop);
}

buildSliders();
buildFeatureTable();
buildStudyGrid();
wireEvents();
resetEmpty();   // start with no words studied, so "Study next" works straight away
loop();
