/* =====================================================================
   tcm.js : the model (a simplified Temporal Context Model)
   ---------------------------------------------------------------------
   No DOM in this file. Everything is plain data and arithmetic, so the
   explainer figures and the sandbox can each create their own World.

   Sections:
     1. Constants      (features, words, race constants, default parameters)
     2. Maths          (vectors, seeded random numbers, context update)
     3. World          (encode, wait, cue, accessibility, recall race)
   ===================================================================== */
'use strict';

const TCM = (() => {

  /* ===================================================================
     1. CONSTANTS
     =================================================================== */

  /** Length of every context / item vector. */
  const DIM = 80;

  /** World features. Each one is a fixed random vector that can recur. */
  const FEATURES = ['Place A (lab)', 'Place B (café)', 'Mood: calm', 'Song', 'Smell: coffee'];

  /** Short column headers (same order as FEATURES). */
  const FEATURE_SHORT = ['A', 'B', 'M', '♪', '☕'];

  /** Words that can be studied, in order. */
  const WORDS = ['Lantern', 'Violin', 'Orchard', 'Compass', 'Anchor', 'Thimble',
                 'Meadow', 'Candle', 'Falcon', 'Marble', 'Ribbon', 'Saddle'];

  /** Constants of the retrieval race. */
  const RACE = {
    gain: 2.5,          // how strongly accessibility drives activation
                        // (too high and noise-floor overlap alone recalls everything)
    threshold: 1,       // activation needed to count as recalled
    dt: 0.05,           // integration step
    maxIdleSteps: 120,  // stop the test after this many steps with no recall
  };

  /** Accessibility a word needs, roughly, to win the race (ignoring noise and competition). */
  const NEEDED = RACE.threshold / RACE.gain;

  /** Adjustable parameters. A World keeps its own copy in world.params. */
  const DEFAULT_PARAMS = {
    encDrift: 0.6,       // beta used when a word is studied
    waitDrift: 0.45,     // beta used for each event while time passes
    reinstate: 0.5,      // beta used when a recalled word's context is blended back in
    featStrength: 1,     // weight of a feature relative to a random input
    cueWeight: 1.5,      // weight of the cue features relative to the current context
    noise: 0.3,          // noise in the race
    competition: 0.1,    // mutual inhibition between words in the race
    decay: 0,            // fraction of each trace lost per event (true forgetting)
  };


  /* ===================================================================
     2. MATHS
     =================================================================== */

  /** Seeded RNG (mulberry32). Same seed gives the same world. */
  function makeRng(seed) {
    let a = seed | 0;
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const dot = (a, b) => { let s = 0; for (let i = 0; i < DIM; i++) s += a[i] * b[i]; return s; };
  const normalize = a => { const n = Math.sqrt(dot(a, a)) || 1; return a.map(x => x / n); };
  const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

  /**
   * Context update:  t_new = rho * t_old + beta * t_input
   * rho is solved so that |t_new| stays 1 (Howard & Kahana, 2002).
   */
  function updateContext(context, input, beta) {
    const d = dot(context, input);
    const rho = Math.sqrt(1 + beta * beta * (d * d - 1)) - beta * d;
    return context.map((x, i) => rho * x + beta * input[i]);
  }


  /* ===================================================================
     3. WORLD
     =================================================================== */

  class World {
    constructor(seed = 1, params = {}) {
      this.params = { ...DEFAULT_PARAMS, ...params };
      this.reset(seed);
    }

    /** Start over: new features, new starting context, no words. */
    reset(seed = this.seed) {
      this.seed = seed;
      this.rng = makeRng(seed || 1);
      this.features = FEATURES.map(() => this.randomUnit());
      this.items = [];      // { word, memory (stored context), index (position in history) }
      this.history = [];    // { context } after every event, starting with the initial context
      this.context = this.randomUnit();
      this.history.push({ context: this.context });
    }

    /** Position of the latest event in the history. */
    get now() { return this.history.length - 1; }

    randn() {
      return Math.sqrt(-2 * Math.log(1 - this.rng())) * Math.cos(2 * Math.PI * this.rng());
    }

    randomUnit() {
      return normalize(Array.from({ length: DIM }, () => this.randn()));
    }

    /** `base` plus every feature k where flags[k] is true, re-normalised. */
    withFeatures(base, flags, weight) {
      const out = base.slice();
      FEATURES.forEach((_, k) => {
        if (flags && flags[k]) for (let i = 0; i < DIM; i++) out[i] += weight * this.features[k][i];
      });
      return normalize(out);
    }

    /**
     * Study the next word. It arrives as a random input plus the features in
     * `flags`. The context after the update is stored with the word.
     */
    encode(flags = null, word = WORDS[this.items.length]) {
      const input = this.withFeatures(this.randomUnit(), flags, this.params.featStrength);
      this.context = updateContext(this.context, input, this.params.encDrift);
      const item = { word, memory: this.context, index: this.history.length };
      this.items.push(item);
      this.history.push({ context: this.context });
      return item;
    }

    /** Let `count` events pass. Features in `flags` recur in every one of them. */
    wait(count = 1, flags = null) {
      for (let e = 0; e < count; e++) {
        const input = this.withFeatures(this.randomUnit(), flags, this.params.featStrength);
        this.context = updateContext(this.context, input, this.params.waitDrift);
        this.history.push({ context: this.context });
      }
    }

    /** Trace strength of item i at history position t (1 unless true decay is on). */
    traceStrength(i, t = this.now) {
      return Math.pow(1 - this.params.decay, t - this.items[i].index);
    }

    /** The retrieval cue: the context plus the features in `cueFlags`. */
    cueFor(context, cueFlags) {
      return this.withFeatures(context, cueFlags, this.params.cueWeight);
    }

    /**
     * Accessibility of item i from `context` (cued with `cueFlags`, or uncued if null):
     *   trace strength x max(0, overlap(stored context, cue))
     * Encoding specificity comes from here: a cue overlaps a stored context only
     * to the extent that they share components.
     */
    accessibility(i, context, cueFlags = null, t = this.now) {
      const cue = cueFlags ? this.cueFor(context, cueFlags) : context;
      return this.traceStrength(i, t) * Math.max(0, dot(this.items[i].memory, cue));
    }

    /** Mean trace strength, mean uncued accessibility and mean cued accessibility. */
    meters(context, cueFlags) {
      const all = this.items.map((_, i) => i);
      return {
        stored: mean(all.map(i => this.traceStrength(i))),
        nocue:  mean(all.map(i => this.accessibility(i, context, null))),
        cued:   mean(all.map(i => this.accessibility(i, context, cueFlags))),
      };
    }

    /** Begin a recall test from the current context. The timeline is untouched. */
    startTest(cueFlags = null) {
      return {
        context: this.context,
        activation: this.items.map(() => 0),
        recalled: [],              // item indices, in output order
        idleSteps: 0,
        at: this.now,              // history position of the test
        cueFlags,                  // may be replaced between steps
        cued: !!cueFlags && cueFlags.some(Boolean),
        paused: false,             // the UI sets this to wait for a button
        over: false,
      };
    }

    /**
     * One step of the leaky competing accumulator:
     *   dx_i = (gain * accessibility_i - x_i - kappa * sum_others(x_j)) * dt + noise
     * The first item to reach the threshold is recalled. Its stored context is
     * then blended into the test context (reinstatement) and the race restarts.
     *
     * Returns a record of the recall if one happened this step, otherwise null.
     */
    stepTest(T) {
      if (T.over) return null;
      const { gain, threshold, dt } = RACE;
      const { competition, noise } = this.params;
      const cue = T.cueFlags ? this.cueFor(T.context, T.cueFlags) : T.context;
      const total = T.activation.reduce((a, b) => a + b, 0);

      T.activation = T.activation.map((x, i) => {
        if (T.recalled.includes(i)) return 0;
        const drive = gain * this.traceStrength(i, T.at) * Math.max(0, dot(this.items[i].memory, cue));
        const inhibition = competition * (total - x);
        return Math.max(0, x + (drive - x - inhibition) * dt + noise * Math.sqrt(dt) * this.randn());
      });

      // Winner: highest activation at or above threshold.
      let winner = -1;
      T.activation.forEach((x, i) => {
        if (x >= threshold && (winner < 0 || x > T.activation[winner])) winner = i;
      });

      if (winner < 0) {
        if (++T.idleSteps > RACE.maxIdleSteps) T.over = true;
        return null;
      }
      return this.recall(T, winner);
    }

    /** Apply a recall: reinstate its context and keep a before/after snapshot. */
    recall(T, winner) {
      const before = T.context;
      const after = updateContext(before, normalize(this.items[winner].memory), this.params.reinstate);
      const all = this.items.map((_, i) => i);

      T.recalled.push(winner);
      const record = {
        rank: T.recalled.length,
        item: winner,
        before,
        after,
        driveBefore: all.map(i => this.accessibility(i, before, T.cueFlags, T.at)),
        driveAfter:  all.map(i => this.accessibility(i, after,  T.cueFlags, T.at)),
        recalled: T.recalled.slice(),
      };

      T.context = after;
      T.activation = this.items.map(() => 0);   // the race restarts from the new context
      T.idleSteps = 0;
      if (T.recalled.length === this.items.length) T.over = true;
      return record;
    }
  }

  return { DIM, FEATURES, FEATURE_SHORT, WORDS, RACE, NEEDED, DEFAULT_PARAMS, World, dot, normalize, mean, updateContext, makeRng };
})();
