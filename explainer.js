/* =====================================================================
   EXPLAINER: small live demos that sit beside the text
   ---------------------------------------------------------------------
   Needs tcm.js (the model) and draw.js (shared drawing helpers).

   Each demo is a function in DEMOS. index.html places it with
       <figure class="demo" data-demo="drift"></figure>
   and the demo builds its own controls and canvas inside that element.
   Every demo owns a small TCM.World, so what you see is the real model
   at a reduced scale, not an animation.

   Sections:
     1. Small DOM helpers
     2. Demos           (one per section of the page)
     3. Startup
   ===================================================================== */
'use strict';


/* =====================================================================
   1. SMALL DOM HELPERS
   ===================================================================== */

/** Create an element: h('div', { class: 'x', onclick: fn }, child, child...) */
function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.entries(props).forEach(([key, value]) => {
    if (key === 'class') node.className = value;
    else if (key === 'style') node.style.cssText = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  });
  children.flat().filter(c => c != null && c !== false).forEach(c => node.append(c));
  return node;
}

const pct = v => Math.round(Math.max(0, v) * 100) + '%';

/** An array of booleans, one per feature, true for the feature numbers in `on`. */
const flagsOf = on => FEATURES.map((_, k) => on.includes(k));

/** Plain names for the features, same order as FEATURES. */
const FEATURE_NAMES = ['Place A', 'Place B', 'Mood', 'Song', 'Smell'];

/** Names of the features set in `flags`, e.g. "Place A and Song". */
function featureNames(flags) {
  const names = FEATURE_NAMES.filter((_, k) => flags[k]);
  if (!names.length) return 'nothing';
  return names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names[0];
}

function button(label, onClick, cls = 'secondary') {
  return h('button', { class: cls, type: 'button', onclick: onClick }, label);
}

/** Canvas with a fixed CSS height (the drawing code reads its size from CSS). */
function canvas(height, description) {
  return h('canvas', { style: `height:${height}px`, role: 'img', 'aria-label': description });
}

/** Range slider with a live value readout. `format` turns the number into text. */
function slider(label, min, max, step, value, onInput, format = v => v) {
  const out = h('output');
  const input = h('input', { type: 'range', min, max, step, 'aria-label': label });
  input.value = value;
  const sync = () => { out.textContent = format(+input.value); };
  input.addEventListener('input', () => { sync(); onInput(); });
  sync();
  return { row: h('div', { class: 'slider' }, h('label', {}, label, out), input), input, get: () => +input.value };
}

/** Row of check-boxes for features. options = [[featureNumber, label], ...] */
function toggles(title, options, onChange, initiallyOn) {
  const boxes = {};
  const items = options.map(([k, label]) => {
    const input = h('input', { type: 'checkbox', 'aria-label': `${title}: ${label}` });
    input.checked = initiallyOn.includes(k);
    input.addEventListener('change', onChange);
    boxes[k] = input;
    return h('label', { class: 'pill' }, input, label);
  });
  return {
    root: h('div', { class: 'toggle-row' }, h('span', { class: 'toggle-title' }, title), items),
    flags: () => FEATURES.map((_, k) => !!boxes[k] && boxes[k].checked),
  };
}

function checkbox(label, onChange) {
  const input = h('input', { type: 'checkbox' });
  input.addEventListener('change', onChange);
  return { root: h('label', { class: 'pill' }, input, label), input };
}

/** Horizontal bar with a label and a value, 0 to 1. `mark` draws a line at that level. */
function meter(label, colourClass, mark) {
  const fill = h('i', { class: colourClass });
  const value = h('span');
  const bar = h('div', { class: 'bar' }, fill, mark != null ? h('b', { class: 'mark', style: `left:${mark * 100}%` }) : null);
  return {
    root: h('div', { class: 'meter wide' }, h('span', {}, label), bar, value),
    set(v, text) {
      fill.style.width = Math.max(0, Math.min(1, v)) * 100 + '%';
      value.textContent = text != null ? text : pct(v);
    },
  };
}

const readout = () => h('p', { class: 'readout', 'aria-live': 'polite' });


/* =====================================================================
   2. DEMOS
   ===================================================================== */

const DEMOS = {};


/** Section 1: stored is not the same as reachable. */
DEMOS.available = root => {
  const world = new TCM.World(3);
  const CUE = flagsOf([0]);                                   // Place A
  WORDS.slice(0, 6).forEach(word => world.encode(flagsOf([0]), word));
  const studiedAt = world.now;
  const MAX = 30;
  world.wait(MAX);

  const time  = slider('Events since the words were studied', 0, MAX, 1, 15, update);
  const decay = checkbox('Let the traces themselves fade (real forgetting)', update);
  const stored = meter('Stored in memory', 'c-muted');
  const nocue  = meter('Reachable, no cue', 'c-blue');
  const cued   = meter('Reachable with the right cue', 'c-green');
  const note   = readout();
  root.append(time.row, decay.root, stored.root, nocue.root, cued.root, note);

  function update() {
    const e = time.get();
    const t = studiedAt + e;
    const ctx = world.history[t].context;
    world.params.decay = decay.input.checked ? 0.03 : 0;

    const all = world.items.map((_, i) => i);
    const s = mean(all.map(i => world.traceStrength(i, t)));
    const n = mean(all.map(i => world.accessibility(i, ctx, null, t)));
    const c = mean(all.map(i => world.accessibility(i, ctx, CUE, t)));
    stored.set(s); nocue.set(n); cued.set(c);

    note.textContent = decay.input.checked
      ? `${e} events later, ${pct(s)} of the traces are left. A cue can only reach what is still stored: ${pct(c)}.`
      : `${e} events later all of the traces are still stored, but only ${pct(n)} can be reached from where the mind is now. With the right cue it is ${pct(c)}.`;
  }
  update();
};


/** Section 2: a context is a pattern, and overlap measures how alike two patterns are. */
DEMOS.context = root => {
  let A, R;
  const cv = canvas(116, 'Two patterns of 80 coloured cells');
  const mix = slider('How much of pattern A is inside pattern B', 0, 1, 0.05, 0.6, draw, v => v.toFixed(2));
  const note = readout();
  root.append(cv, mix.row, button('New random patterns', () => fresh(Math.floor(Math.random() * 1e9))), note);

  function fresh(seed) {
    const w = new TCM.World(seed);
    A = w.randomUnit();
    R = w.randomUnit();
    draw();
  }

  function draw() {
    const m = mix.get();
    const B = TCM.normalize(A.map((a, i) => m * a + (1 - m) * R[i]));
    const overlap = dot(A, B);

    const [g, w] = setupCanvas(cv);
    g.font = '12px system-ui';
    [[A, 'Pattern A'], [B, 'Pattern B']].forEach(([vec, label], r) => {
      g.fillStyle = textColor();
      g.fillText(label, 0, r * LAYOUT.stripBlock + 11);
      drawVector(g, vec, 0, r * LAYOUT.stripBlock + 16, w, 22, 5);
    });

    const verdict = overlap > 0.9 ? 'almost identical'
                  : overlap > 0.6 ? 'clearly similar'
                  : overlap > 0.3 ? 'weakly related'
                  : 'unrelated';
    note.innerHTML = `Overlap <b>${num2(overlap)}</b>: ${verdict}.`;
  }

  fresh(4);
  onRedraw(draw);
};


/** Section 3: each event moves the context a little further from where it was. */
DEMOS.drift = root => {
  let world, studied, contexts;
  const cv = canvas(150, 'The studied context, the current context, and their overlap at every event');
  const beta = slider('Drift per event (β)', 0.05, 0.9, 0.05, 0.45, () => {},
                      v => `β ${v.toFixed(2)}, keeps about ${Math.sqrt(1 - v * v).toFixed(2)} of the old context`);
  const note = readout();
  root.append(cv, beta.row,
    h('div', { class: 'button-row' },
      button('+1 event', () => step(1)), button('+5 events', () => step(5)), button('+20 events', () => step(20)),
      button('Start again', () => start(Math.floor(Math.random() * 1e9)))),
    note);

  function start(seed) {
    world = new TCM.World(seed);
    world.encode(null, 'word');
    studied = world.context;
    contexts = [studied];
    draw();
  }

  function step(count) {
    world.params.waitDrift = beta.get();
    for (let i = 0; i < count; i++) {
      world.wait(1);
      contexts.push(world.context);
    }
    draw();
  }

  function draw() {
    const [g, w] = setupCanvas(cv);
    const now = contexts[contexts.length - 1];
    const overlap = dot(studied, now);
    g.font = '12px system-ui';

    g.fillStyle = textColor();
    g.fillText('Context when the word was studied', 0, 11);
    drawVector(g, studied, 0, 16, w, 22, 5);

    g.fillStyle = textColor();
    g.fillText(`Context now, after ${contexts.length - 1} events   overlap with studied: ${num2(overlap)}`, 0, 55);
    drawVector(g, now, 0, 60, w, 22, 5);

    g.fillStyle = textColor();
    g.fillText('Overlap with the studied context, event by event', 0, 99);
    const cells = Math.max(40, contexts.length), cellW = w / cells;
    contexts.forEach((c, j) => {
      g.fillStyle = cellColor(dot(studied, c), 1.3);
      g.fillRect(j * cellW, 104, cellW + 0.5, 22);
    });
    g.strokeStyle = COLORS.frame;
    g.strokeRect(0, 104, w, 22);
    g.fillStyle = textColor();
    g.fillText('studied', 0, 142);
    g.textAlign = 'right';
    g.fillText('later events →', w, 142);
    g.textAlign = 'left';

    note.innerHTML = contexts.length === 1
      ? 'Nothing has happened yet. Add some events.'
      : `The old context is still in there, just diluted: overlap <b>${num2(overlap)}</b>.`;
  }

  start(2);
  onRedraw(draw);
};


/** Section 4: studying stores the word together with the context it was studied in. */
DEMOS.encode = root => {
  const LIST = 6, LABEL = 120;
  let world, tags;
  const present = toggles('Present while studying:', [[0, 'Place A'], [1, 'Place B'], [3, 'Song']], () => {}, [0]);
  const cv = canvas(262, 'Stored contexts of the studied words and how much they overlap');
  const note = readout();
  root.append(present.root,
    h('div', { class: 'button-row' },
      button('Study next word', studyNext, ''), button('+3 events', () => { world.wait(3); draw(); }),
      button('Start again', () => start())),
    cv, note);

  function start() {
    world = new TCM.World(5);
    tags = [];
    draw();
  }

  function studyNext() {
    if (world.items.length >= LIST) return;
    const flags = present.flags();
    world.encode(flags, WORDS[world.items.length]);
    tags.push(flags.some(Boolean) ? FEATURE_SHORT.filter((_, k) => flags[k]).join('') : 'none');
    draw();
  }

  function draw() {
    const [g, w] = setupCanvas(cv);
    const { items } = world;
    g.font = '11px system-ui';
    g.textBaseline = 'alphabetic';

    // Stored contexts: one strip per word.
    items.forEach((item, i) => {
      g.fillStyle = textColor();
      g.fillText(`${item.word}  (${tags[i]})`, 0, i * 16 + 11);
      drawVector(g, item.memory, LABEL, i * 16, w - LABEL, 14, 5);
    });
    if (!items.length) {
      g.fillStyle = textColor();
      g.fillText('Nothing studied yet. Press “Study next word”.', 0, 12);
    }

    // How alike the stored contexts are.
    const top = LIST * 16 + 18;
    g.fillStyle = textColor();
    g.fillText('How alike are the stored contexts? (overlap)', 0, top);
    const cw = (w - LABEL) / LIST, ch = 20;
    items.forEach((a, i) => {
      g.fillStyle = textColor();
      g.fillText(a.word, 0, top + 10 + i * ch + 14);
      items.forEach((b, j) => {
        const v = dot(a.memory, b.memory);
        g.fillStyle = cellColor(v, 1.2);
        g.fillRect(LABEL + j * cw, top + 10 + i * ch, cw - 1, ch - 1);
        g.fillStyle = textColor();
        g.textAlign = 'center';
        g.fillText(i === j ? '1' : v.toFixed(2).replace('0.', '.').replace('-0.', '-.'), LABEL + j * cw + cw / 2, top + 10 + i * ch + 14);
        g.textAlign = 'left';
      });
    });

    if (items.length >= 4) {
      const near = [], far = [];
      items.forEach((a, i) => items.forEach((b, j) => {
        if (j <= i) return;
        (j - i === 1 ? near : j - i >= 3 ? far : []).push(dot(a.memory, b.memory));
      }));
      note.innerHTML = `Words studied one after another overlap by about <b>${mean(near).toFixed(2)}</b>. Words three or more steps apart: <b>${mean(far).toFixed(2)}</b>.`;
    } else {
      note.textContent = 'Study at least four words to see the pattern.';
    }
  }

  start();
  onRedraw(draw);
};


/** Section 5: a cue works only as far as it overlaps with the stored context. */
DEMOS.cues = root => {
  const OPTIONS = [[0, 'Place A'], [1, 'Place B'], [3, 'Song'], [4, 'Smell']];
  const DELAY = 20, LIST = 4;
  const studyT = toggles('Present when the words were studied:', OPTIONS, draw, [0, 3]);
  const cueT   = toggles('Added to the cue at test:', OPTIONS, draw, []);
  const cv = canvas(136, 'Stored context, current context and cue');
  const mNow = meter('Current context alone', 'c-blue', NEEDED);
  const mCue = meter('Cue with chosen features', 'c-green', NEEDED);
  const note = readout();
  root.append(studyT.root, cueT.root, cv, mNow.root, mCue.root, note);

  function draw() {
    const studyFlags = studyT.flags(), cueFlags = cueT.flags();

    // Same seed every time, so only the ticked features change the picture.
    // Four words are studied together (as in a real list); we follow the last one.
    const w = new TCM.World(4);
    WORDS.slice(0, LIST).forEach(word => w.encode(studyFlags, word));
    const stored = w.items[LIST - 1].memory;
    w.wait(DELAY);
    const now = w.context;
    const cue = w.cueFor(now, cueFlags);
    const oNow = dot(stored, now), oCue = dot(stored, cue);

    const [g, width] = setupCanvas(cv);
    g.font = '12px system-ui';
    [[stored, `Stored context of the last of ${LIST} words studied with ${featureNames(studyFlags)}`],
     [now,    `Current context, ${DELAY} events later   overlap with stored: ${num2(oNow)}`],
     [cue,    `Cue: current context + ${featureNames(cueFlags)}   overlap with stored: ${num2(oCue)}`],
    ].forEach(([vec, label], r) => {
      g.fillStyle = textColor();
      g.fillText(label, 0, r * LAYOUT.stripBlock + 11);
      drawVector(g, vec, 0, r * LAYOUT.stripBlock + 16, width, 22, 5);
    });

    mNow.set(oNow, num2(oNow));
    mCue.set(oCue, num2(oCue));

    const shared = studyFlags.map((on, k) => on && cueFlags[k]);
    note.textContent =
      !cueFlags.some(Boolean)        ? 'No cue chosen. The drifted context no longer resembles the stored one, so the word cannot be reached.'
      : oCue >= NEEDED               ? `The cue shares ${featureNames(shared)} with the stored context. That is enough to win the race.`
      : shared.some(Boolean)         ? `The cue shares ${featureNames(shared)} with the stored context, but not enough on its own.`
      :                                'Nothing in this cue was part of the stored context, so it adds nothing.';
  }

  draw();
  onRedraw(draw);
};


/** Section 6: retrieval is a noisy race between memories. */
DEMOS.race = root => {
  const world = new TCM.World(21);
  WORDS.slice(0, 6).forEach(word => world.encode(flagsOf([0]), word));
  world.wait(20);

  const CUES = { right: flagsOf([0]), wrong: flagsOf([1]), none: null };
  const CHOICES = [['right', 'Place A (was present at study)'], ['wrong', 'Place B (was not)'], ['none', 'No cue']];
  let cueKey = 'right', T = null, winner = null, frame = 0, message = '';

  const radios = h('div', { class: 'toggle-row' }, h('span', { class: 'toggle-title' }, 'Cue:'),
    CHOICES.map(([key, label]) => {
      const input = h('input', { type: 'radio', name: 'race-cue' });
      input.checked = key === cueKey;
      input.addEventListener('change', () => { cueKey = key; reset(); });
      return h('label', { class: 'pill' }, input, label);
    }));
  const cv = canvas(6 * LAYOUT.raceRow + 8, 'Activation of six words racing towards a threshold');
  const note = readout();
  root.append(radios, h('div', { class: 'button-row' }, button('Run the race', run, ''), button('Reset', reset)), cv, note);

  /** How hard the cue pulls on each word. 1.0 would reach the threshold (before noise). */
  const pulls = () => world.items.map((_, i) => RACE.gain * world.accessibility(i, world.context, CUES[cueKey]));

  function reset() {
    cancelAnimationFrame(frame);
    T = null; winner = null; message = '';
    draw();
  }

  function run() {
    cancelAnimationFrame(frame);
    T = world.startTest(CUES[cueKey]);
    winner = null;
    message = 'Racing...';
    tick();
  }

  function tick() {
    for (let s = 0; s < 3 && !T.over; s++) {
      const record = world.stepTest(T);
      if (record) { winner = record.item; T.over = true; }
    }
    if (T.over) {
      message = winner != null
        ? `${world.items[winner].word} reached the threshold first and was recalled. Run it again: the winner can change.`
        : 'Time ran out and nothing reached the threshold. The memories are stored, but this cue does not lead to them.';
    }
    draw();
    if (!T.over) frame = requestAnimationFrame(tick);
  }

  function draw() {
    const [g, w, hgt] = setupCanvas(cv);
    const left = 80, right = 70, barW = w - left - right, rowH = LAYOUT.raceRow;
    const p = pulls();
    g.font = '12px system-ui';
    g.textBaseline = 'middle';

    world.items.forEach((item, i) => {
      const y = 4 + i * rowH;
      const x = T ? T.activation[i] : 0;
      g.fillStyle = textColor();
      g.fillText(item.word, 0, y + rowH / 2);
      g.fillStyle = COLORS.track;
      g.fillRect(left, y + 3, barW, rowH - 6);
      g.fillStyle = winner === i ? COLORS.green : COLORS.blue;
      g.fillRect(left, y + 3, winner === i ? barW : Math.min(1, x / (2 * RACE.threshold)) * barW, rowH - 6);
      g.fillStyle = textColor();
      g.fillText(`pull ${p[i].toFixed(1)}`, left + barW + 8, y + rowH / 2);
    });

    g.strokeStyle = COLORS.orange;
    g.beginPath(); g.moveTo(left + barW / 2, 2); g.lineTo(left + barW / 2, hgt - 2); g.stroke();

    note.textContent = message || 'Pick a cue and run the race. A word needs a pull of about 1.0 or more to reach the threshold (orange line).';
  }

  draw();
  onRedraw(draw);
};


/** Section 7: recalling a word pulls its context back, which changes what else is within reach. */
DEMOS.reinstate = root => {
  const world = new TCM.World(33);
  WORDS.slice(0, 6).forEach(word => world.encode(null, word));
  world.wait(8);
  let T, record;

  const beta = slider('Reinstatement (β)', 0, 0.9, 0.05, 0.5, () => { world.params.reinstate = beta.get(); }, v => v.toFixed(2));
  const chips = world.items.map((item, i) => h('button', { class: 'chip', type: 'button', onclick: () => recall(i) }, item.word));
  const cv = canvas(reinstateHeight(6), 'What recalling a word does to the context and to every word’s accessibility');
  const note = readout();
  root.append(h('div', { class: 'chips' }, chips), beta.row,
    h('div', { class: 'button-row' }, button('Start again', reset)), cv, note);

  function reset() {
    T = world.startTest(null);
    record = null;
    draw();
  }

  function recall(i) {
    if (T.recalled.includes(i)) return;
    record = world.recall(T, i);
    draw();
  }

  function draw() {
    drawReinstatementChart(cv, record, world.items, 'Click a word above to pretend it was just recalled.');
    chips.forEach((chip, i) => {
      const done = T.recalled.includes(i);
      chip.classList.toggle('recalled', done);
      chip.disabled = done;
    });
    if (!record) {
      note.textContent = 'No cue here, only the context. Right now almost no word is within easy reach.';
      return;
    }
    const gains = record.driveAfter.map((v, i) => (T.recalled.includes(i) ? -Infinity : v - record.driveBefore[i]));
    const best = gains.indexOf(Math.max(...gains));
    note.innerHTML = gains[best] > -Infinity
      ? `Biggest gain: <b>${world.items[best].word}</b> (+${gains[best].toFixed(2)}). Recall another word to keep the chain going.`
      : 'Every word has been recalled.';
  }

  reset();
  onRedraw(draw);
};


/* =====================================================================
   3. STARTUP
   ===================================================================== */

document.querySelectorAll('[data-demo]').forEach(el => {
  const start = DEMOS[el.dataset.demo];
  if (start) start(el);
});
