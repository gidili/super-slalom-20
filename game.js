(() => {
  'use strict';

  // ------------------------------------------------------------- the screen
  // An old 4:3 TV, filled with snow edge to edge: 28 x 21 characters of
  // 8 x 8 pixels. Wider than the VIC-20's stock 22 columns, to leave room
  // off the piste for shortcuts. W is also the width of the mountain itself.
  const W = 224;
  // A phone held upright (snake-bit's test, made once at load) gets the
  // same mountain through a narrower window, 18 characters wide, as tall as
  // the screen allows. The window slides sideways to follow the piste, so
  // the course, and the score, are the same as on the TV.
  const NARROW = window.innerWidth / window.innerHeight < 0.85;
  // The TV draws its pixels about PIXEL screen points wide, so a big screen
  // sees further down the slope instead of a blown-up skier: as much
  // mountain as fits, centred, with forest past its edges to fill the sides.
  const PIXEL = 4.5;
  const tvWidth = Math.min(window.innerWidth - 32, (window.innerHeight - 32) * 4 / 3);
  const VW = NARROW ? 144 : Math.max(W, Math.min(400, Math.floor(tvWidth / PIXEL / 4) * 4));
  const H = NARROW ? Math.round(VW * window.innerHeight / window.innerWidth) : VW * 3 / 4;
  const MARGIN = (VW - W) / 2 > 0 && !NARROW ? (VW - W) / 2 : 0;   // forest past each edge
  const EDGE_STRIP = 6;        // the solid blue at the TV's sides

  // The VIC-20's palette. Nothing outside this list is ever drawn.
  const VIC = {
    black: [0, 0, 0],          white: [255, 255, 255],
    red: [120, 41, 34],        cyan: [135, 214, 221],
    blue: [64, 49, 141],       green: [85, 160, 73],
    orange: [170, 116, 73],    lightBlue: [128, 128, 255],
    yellow: [191, 206, 114],
    paleBlue: [184, 184, 255], // the steep-face tint only
    pink: [226, 150, 190],     // the VIC-20's pink, for cherry blossom
    netOrange: [236, 132, 48], // the VIC-20's light orange, for safety nets
    crimson: [214, 40, 56],    // rātā flowers
    dawn: [255, 228, 208],     // snow in the first light
  };
  const css = c => `rgb(${c[0]},${c[1]},${c[2]})`;

  // ---------------------------------------------------------------- course
  // POLE_COUNT, RED_COUNT and the scoring below are also hard-coded in
  // slalom_submit_score, which recomputes the score and rejects any that
  // disagrees. Change both or neither.
  const POLE_COUNT = 25;
  const RED_COUNT = 4;         // every course has exactly this many red poles
  // The score only goes up: points for each pole cleared, more for a red
  // one, then at the finish a bonus for crossing the line and one for every
  // hundredth of a second under par. A crash keeps its pole points but
  // gets neither bonus, so finishing always beats a crash on the same poles.
  // Tuned with an autopilot: a clean 29.3s makes about 1000, and 2000 takes
  // a clean 27.3s, which is autopilot territory.
  const POLE_POINTS = 10;
  const RED_POINTS = 25;       // on top of the pole's own
  const FINISH_POINTS = 50;
  const PAR_CS = 3040;         // no time bonus at or over 30.40s
  const BONUS_PER_CS = 5;
  // A missed pole adds 0.60s to the time the bonus is worked out on.
  // Skipping one pole saves 0.45s on average (autopilot, normal poles;
  // 0.24s in quick sections), so a well-chosen skip can pay. Skipping many
  // saves more each, since you stay tucked (straight down the hill saved
  // 0.65s a pole), so past MISS_LIMIT misses there's no time bonus at all.
  const MISS_CS = 60;
  const MISS_LIMIT = 3;
  // Brushing a pole on the flag side, close enough to knock it flat.
  // Clips in a row are a combo: each is worth CLIP_POINTS times its place
  // in the streak, up to COMBO_CAP times. A pole cleared without a clip,
  // or missed, ends the streak.
  const CLIP_POINTS = 10;
  const COMBO_CAP = 12;
  // At FIRE_AT in a row the skier catches fire, until the streak breaks.
  // Also in slalom_submit_score. On fire,
  // pineapples, trees and fences explode for points instead of ending
  // the run.
  const FIRE_AT = 4;
  const BURN_POINTS = { pine: 50, tree: 25, fence: 25 };
  // Stars, for a finished run only (a crash gets none). One for finishing;
  // two for a few misses at most and the bonus time under par; three for
  // no misses and a tight run. Display only; the server never needs them,
  // though they can be worked out from any saved payload.
  const STAR2_MISSES = 2;
  const STAR3_CS = 2930;       // run time for three stars

  // One pole per turn, real-slalom style: the flag points to the side you
  // pass on, and the sides alternate down the course.
  // The gaps shrink down the course, so the end is the hard part.
  const POLE_GAP_FIRST = 95;   // world px between the first two poles
  const POLE_GAP_LAST = 65;    // ...and the last two
  const POLE_OFFSET = 12;      // how far off the piste centre a pole stands
  // Quick sections: runs of poles packed close together, set nearer the
  // centre so a fast left-right-left can still make them. The seed places
  // them, never among the first few poles.
  const QUICK_SECTIONS = 2;
  const QUICK_POLES = 5;       // poles in each
  const QUICK_GAP = 40;
  const QUICK_OFFSET = 5;
  // Endless: poles evenly spaced, about a mid-course gap, made this far
  // ahead of the skier and dropped this far behind (both off screen).
  const ENDLESS_GAP = 80;
  // ...and how the slope gets harder: long calm stretches, then a storm.
  // How long each lasts and how hard it hits can't be predicted, but the
  // ceiling keeps rising, so sooner or later one is worse than any before.
  const ENDLESS_CALM = [700, 2200];    // rows of calm
  const ENDLESS_STORM = [500, 1600];   // rows of storm
  const ENDLESS_TIGHTEN = 22;  // how much the gap shrinks at full difficulty
  const ENDLESS_SWING = 6;     // how much further out the poles stand
  const ENDLESS_QUICK = 0.3;   // chance per pole of a bunched-up stretch
  const ENDLESS_AHEAD = H + 200;
  const ENDLESS_BEHIND = 200;
  const ENDLESS_RED = 1 / 6;   // chance a pole is red
  const ENDLESS_MISSES = 4;    // the 4th ends the run; forks count
  const QUICK_FIRST = 4;       // the earliest pole a section can start on
  // Where a pole passes the skier, measured from the skier's centre toward
  // the flag side. The skis sit a pixel either side of centre: a pole
  // between them, or touching on the wrong side, is a fork; just outside
  // them on the flag side, a clip. Both knock it over.
  const SKIS = 1.5;            // between the skis
  const CLIP_REACH = 5.5;      // the far edge of a touch, either side
  const LINE_WIDE = 6;         // the worn line passes this far outside a pole
  const LINE_HW = 3;           // ...and is this wide either side
  const START_PAD = 120;
  const FINISH_PAD = 120;      // after the last pole
  // Near the end the slope stops scrolling with the finish line this far
  // down the screen, and the skier runs down to it. Past the last pole.
  // 28 rows up from the bottom on the TV; on a phone, just above the arrow
  // buttons so they never cover the line.
  const FINISH_ROW = H - (NARROW ? 65 : 28);
  const PATH_HW = 40;          // groomed piste, half width

  // Off the piste, "depth" runs from 0 at the piste edge to 1 at the screen
  // edge on that side. It drives the light-blue speckle, the drag, and how
  // likely a tree is, so what you see is what slows you.
  const TREE_CELL = 12;        // trees are placed at most one per cell
  const TREE_EDGE = 0.06;      // chance of a tree per cell right at the piste
  const TREE_MAX = 0.75;       // ...rising to this at the screen edge
  const EDGE_WOBBLE = 14;      // the piste edge bulges out by up to this much
  // Wooden fences lie across the fresh snow, closing off some shortcuts.
  const FENCE_SLOT = 40;       // at most one fence per side per this many rows
  const FENCE_CHANCE = 0.3;
  const INTRUDE_CHANCE = 1 / 3; // ...of which this many reach into the piste
  const INTRUDE_MAX = 15;      // ...by up to this much
  const PISTE_TREE = 0.015;    // chance per cell of a tree on the piste itself
  // Anything deadly on the piste stays this far from the racing line, and
  // this far from a pole, so the ideal line is always open.
  const CLEAR_LINE = 24;
  const CLEAR_POLE = 9;
  // Pineapples turn up anywhere, piste included, about 12 a run. Dodging
  // them is the point, so only the poles are kept clear.
  const PINE_CHANCE = 1 / 240; // chance per tree cell
  const PINE_PISTE = 1.1;      // ...times this on the piste itself

  const SKIER_Y = Math.round(H * (NARROW ? 0.22 : 0.3));   // skier's fixed screen row
  const DOWN_SPEED = 72;       // px/s straight down on the piste
  const CARVE_FACTOR = 0.82;   // steering costs a little speed
  const TUCK_BONUS = 0.3;      // extra speed after holding a straight line...
  const TUCK_RAMP = 0.9;       // ...reached over this many seconds,
  const TUCK_EXTRA = 0.3;      // ...then this much more if you keep going
  const TUCK_EXTRA_RAMP = 1.6; // ...over this many seconds after that
  const ACCEL_RATE = 1.5;      // speeding up is gradual
  const DECEL_RATE = 3;        // slowing down is quicker
  const LATERAL = 56;          // px/s sideways while steering
  const DEEP_SNOW_DRAG = 0.65; // speed lost at full depth
  const MIN_TURN = 0.1;        // a tap turns for at least this long (s)

  // The course is deterministic per seed, but the server never rebuilds it:
  // it only checks counts, which are fixed (POLE_COUNT, RED_COUNT). So the
  // seed is free to drive shape and red positions in any way, as long as it
  // is deterministic, which keeps a reported run auditable later.
  function mulberry32(a) {
    return () => {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Exactly RED_COUNT red poles per course, so every run has the same bonus
  // available and the leaderboard measures skiing, not seed luck. Drawn
  // from their own PRNG stream, so tuning the course shape never moves them.
  // Never the first pole: it can't be missed, so red there would be free.
  function pickRedPoles(seed, count = POLE_COUNT, reds = RED_COUNT) {
    const rnd = mulberry32((seed % 4294967296) ^ 0x5EED);
    const idx = Array.from({ length: count - 1 }, (_, i) => i + 1);
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    return new Set(idx.slice(0, reds));
  }

  // The poles in quick sections, by index. Sections never touch: at least
  // two ordinary gaps between them, and one before the finish.
  function pickQuickPoles(seed, count = POLE_COUNT, sections = QUICK_SECTIONS, len = QUICK_POLES) {
    if (!sections) return new Set();
    const rnd = mulberry32((seed % 4294967296) ^ 0x0B1C);
    const last = count - 1 - len;    // latest start
    // (Only shapes that fit are ever asked for, so this always ends.)
    for (;;) {
      const starts = [];
      for (let k = 0; k < sections; k++) {
        starts.push(QUICK_FIRST + Math.floor(rnd() * (last - QUICK_FIRST + 1)));
      }
      starts.sort((a, b) => a - b);
      if (starts.every((s, k) => k === 0 || s - starts[k - 1] >= len + 2)) {
        const set = new Set();
        for (const s of starts) for (let i = 0; i < len; i++) set.add(s + i);
        return set;
      }
    }
  }

  let course = null;

  // How a course is laid out. Single and Endless use this as it is; each
  // Championship mountain changes some of it (see shapeOf).
  const SHAPE = {
    poles: POLE_COUNT, reds: RED_COUNT,
    gapFirst: POLE_GAP_FIRST, gapLast: POLE_GAP_LAST,   // between poles, top and bottom
    gaps: null,                // ...or [[t, gap], ...] down the poles (t 0..1), like width
    offset: POLE_OFFSET, offsetLast: POLE_OFFSET,       // how far out they stand
    jitter: 4,                 // ...plus up to this much, at random
    quick: QUICK_SECTIONS,     // bunched-up stretches...
    quickLen: QUICK_POLES,     // ...this many poles each...
    quickGap: QUICK_GAP,       // ...this far apart
    width: PATH_HW,            // piste half width, or [[t, hw], ...] down the course (t 0..1)
    slope: 1,                  // how steep: speed times this, or [[t, x], ...] like width
    signs: [],                 // boards by the piste: [{ t, lines: [...], flag }]
    borders: [],               // a national border across the slope, at these t
    welcome: '',               // ...and what flashes up as you cross it
    edgeNets: 0,               // a resort: orange safety nets on the outside of this share of the bends
    lift: false,               // ...and a chairlift running up one side
    arena: false,              // ...and the crowd in a ring behind a barrier past the finish
    couloir: null,             // a pole-less gully between rock walls at the top (see buildCourse)
    rocks: 0,                  // the share of trees that are boulders instead
    debris: 0,                 // boulders strewn on the piste itself, or [[t, density], ...]
    fences: 1,                 // fences, times Single's (0: none)
    camp: false,               // a base camp of tents beside the finish
    fans: 5,                   // people cheering at the finish
    cameras: 0,                // ...of whom this many are taking photos
    penguinFans: false,        // ...or penguins instead of people, jumping for joy
    heli: false,               // dropped off by helicopter at the start
    moths: false,              // Bogong moth swarms fluttering past
    cherry: 0,                 // share of trees that are cherries in bloom, or [[t, share], ...]
    rata: 0,                   // share of trees that are southern rātā in flower, in clumps
    scree: 0,                  // bare volcanic scree showing through the snow: how much (0..1), or [[t, x], ...]
    snowBand: null,            // ...and past this far beyond the piste, [[t, px], ...], bare all over
    forest: 1,                 // trees off the piste, times Single's
    ice: 0,                    // ice cliffs at the sides down to this t
    bushes: false,             // low scrub instead of pines
    groundsels: false,         // giant groundsels instead of pines
    darkRock: false,           // bare rock is dark blue-black, not brown
    dawn: false,               // first light: warm snow, long shadows
    penitentes: 0,             // fields of snow blades, on the piste too: how much ground they cover (0..1)
    tussock: false,            // yellow tussock grass off the piste
    dogs: 0,                   // stray dogs: chance per slot and side that one's about
    wildlife: null,            // this mountain's own animals: { odds, kinds: { kind: weight } }
    icy: false,                // an ice field: blocks of ice for trees, glinting cyan edges...
    crevasses: false,          // ...and crevasses where fences would be
    wind: false,               // katabatic gusts that push you sideways
    avalanche: null,           // { from, to }: an avalanche chases you from pole `from` to pole `to`
    night: null,               // how dark it is down the course, [[t, darkness 0..1], ...]; a headlamp
    serac: null,               // { from, to, side }: a hanging ice cliff shedding chunks across the piste
    treeline: 0,               // above this t (0..1 down the course) nothing grows: bare rock, sparser
    pines: 1,                  // pineapples, times Single's
    twist: 1,                  // how far the piste wanders
    sway: 1,                   // ...and how often: under 1 is longer, lazier bends
    crowd: 1,                  // trees and pineapples on the piste, times Single's
    par: PAR_CS, star3: STAR3_CS,
  };

  // A value that changes down the course (a width, a slope): straight
  // lines between the points, flat past the ends.
  function alongCourse(width, finishY) {
    if (typeof width === 'number') return () => width;
    return (y) => {
      const t = y / finishY;
      if (t <= width[0][0]) return width[0][1];
      for (let k = 1; k < width.length; k++) {
        const [t1, w1] = width[k], [t0, w0] = width[k - 1];
        if (t <= t1) return w0 + (w1 - w0) * (t - t0) / (t1 - t0);
      }
      return width[width.length - 1][1];
    };
  }
  // The piste's half width at a world row.
  const pisteHW = y => (course ? course.widthAt(y) : PATH_HW);

  function buildCourse(seed, endless = false, shape = SHAPE) {
    const S = shape;
    const redPoles = pickRedPoles(seed, S.poles, S.reds);
    const rnd = mulberry32(seed % 4294967296);
    const f1 = (0.006 + rnd() * 0.004) * S.sway, p1 = rnd() * Math.PI * 2;
    const f2 = (0.017 + rnd() * 0.008) * S.sway, p2 = rnd() * Math.PI * 2;
    const baseCenter = y => W / 2 + S.twist * 18 * Math.sin(y * f1 + p1) + S.twist * 10 * Math.sin(y * f2 + p2);

    // A couloir: from row K.start, K.rows of narrow gully between rock
    // walls, bending as K.bends says, steep, no poles. Then it opens out
    // over K.open rows onto the slope proper.
    const K = S.couloir;
    const c0 = K ? K.start : 0, c1 = K ? K.start + K.rows : 0, c2 = K ? c1 + K.open : 0;
    const smooth = t => t * t * (3 - 2 * t);
    // The gully's line: through K.bends ([rows in, offset], ...), easing
    // into and out of each. A bend that moves far over few rows is a
    // dangerous one: about 3 rows down per pixel across is the limit at
    // couloir speed.
    const zig = y => {
      const b = K.bends, d = y - c0;
      for (let k = 1; k < b.length; k++) {
        if (d <= b[k][0]) {
          const t = (d - b[k - 1][0]) / (b[k][0] - b[k - 1][0]);
          return b[k - 1][1] + (b[k][1] - b[k - 1][1]) * (1 - Math.cos(Math.PI * t)) / 2;
        }
      }
      return b[b.length - 1][1];
    };
    const centerAt = !K ? baseCenter : y =>
      y < c0 ? baseCenter(y)
        : y <= c1 ? baseCenter(c0) + zig(y)
        : baseCenter(c0) + (baseCenter(y) - baseCenter(c0)) * smooth(Math.min(1, (y - c1) / K.open));

    // The seed picks the first pole's side; after that they alternate, so
    // the line is a slalom, not a schuss. Each pole is passed on its
    // outside, away from the piste centre, which is what makes you weave.
    // The first pole too: every pole has a flag, so there's no free choice
    // that the rest of the course would then ignore.
    const first = rnd() < 0.5 ? -1 : 1;
    const quick = pickQuickPoles(seed, S.poles, S.quick, S.quickLen);
    const gapAt = S.gaps ? alongCourse(S.gaps, 1) : null;
    const poles = [];
    let y = K ? c2 + START_PAD - 60 : START_PAD;
    for (let i = 0; i < (endless ? 0 : S.poles); i++) {
      const t = (i - 1) / (S.poles - 2);
      if (i > 0) {
        y += quick.has(i) && quick.has(i - 1)
          ? S.quickGap
          : S.gaps ? gapAt((i - 1) / (S.poles - 2))
          : S.gapFirst + (S.gapLast - S.gapFirst) * (i - 1) / (S.poles - 2);
      }
      y = Math.round(y);
      const side = i % 2 === 0 ? first : -first;
      const off = quick.has(i) ? QUICK_OFFSET + rnd() * 2
        : S.offset + (S.offsetLast - S.offset) * Math.max(0, t) + rnd() * S.jitter;
      const x = Math.round(centerAt(y) + side * off);
      // pass: side to pass on. fallen: 0 standing, else the direction it
      // fell (-1 left, 1 right).
      poles.push({ y, x, side, pass: side, red: redPoles.has(i), result: null, fallen: 0 });
    }
    const finishY = endless ? Infinity : y + FINISH_PAD;

    // The racing line: start at the top of the piste, swing past each pole
    // just outside it, end mid-piste at the finish. Drawn as a worn track
    // in the snow.
    const pts = [{ y: 0, x: centerAt(0) }]
      .concat(K ? [c0, c1, c2].map(cy => ({ y: cy, x: centerAt(cy) })) : [])
      .concat(poles.map(p => ({ y: p.y, x: p.x + p.side * LINE_WIDE })))
      .concat(endless ? [] : [{ y: finishY, x: centerAt(finishY) }]);
    const lineAt = (wy) => {
      if (wy <= 0) return pts[0].x;
      if (K && wy >= c0 && wy <= c1) return centerAt(wy);   // down the middle of the gully
      for (let k = 1; k < pts.length; k++) {
        if (wy <= pts[k].y) {
          const a = pts[k - 1], b = pts[k];
          const t = (1 - Math.cos(Math.PI * (wy - a.y) / (b.y - a.y))) / 2;
          return a.x + (b.x - a.x) * t;
        }
      }
      return pts[pts.length - 1].x;
    };

    // Mixed into tree placement, so each seed gets its own forest.
    const salt = Math.floor(seed / 4096) % 1000003;

    // The pineapple on the title screen, which is the top of this course:
    // anywhere across it, piste included, below the title text and short of
    // the first pole. Its own PRNG stream, like the red poles.
    const prnd = mulberry32((seed % 4294967296) ^ 0x9A1E);
    const titlePine = {
      i: 't', j: 't', pine: true,
      x: 4 + Math.floor(prnd() * (W - 8)),
      y: (K ? 24 : 64) + Math.floor(prnd() * 40),   // above a couloir, if there is one
    };
    // Endless never has the whole slope: called every step, this makes the
    // poles coming up and forgets those long gone, so only a few screens'
    // worth exist at once.
    // How hard Endless is at a row, from 0 toward (never reaching) 1. From
    // the course's seed alone, so the slope stays put once it's made.
    const waves = [];
    const addWave = () => {
      const i = waves.length, start = i ? waves[i - 1].end : 0, roll = n => hash(i * 7919 + salt, n);
      const span = ([a, b], r) => a + r * (b - a);
      const stormAt = start + span(ENDLESS_CALM, roll(1)), end = stormAt + span(ENDLESS_STORM, roll(2));
      const ceiling = 1 - 0.75 * Math.exp(-(i + 1) / 5);
      const peak = roll(3) < 0.4 ? ceiling : ceiling * (0.55 + 0.4 * roll(4));
      waves.push({ start, stormAt, end, peak, rest: 0.05 + 0.15 * (1 - Math.exp(-i / 10)) });
    };
    const levelAt = (wy) => {
      const d = Math.max(0, wy - START_PAD);
      while (!waves.length || waves[waves.length - 1].end <= d) addWave();
      let k = waves.length - 1;
      while (waves[k].start > d) k--;
      const w = waves[k];
      if (d < w.stormAt) return w.rest;
      const t = (d - w.stormAt) / (w.end - w.stormAt);
      return w.rest + (w.peak - w.rest) * Math.min(1, t / 0.25, (1 - t) / 0.2);
    };

    let made = 0, lastY = START_PAD - ENDLESS_GAP, bunched = 0;
    const extend = (at) => {
      while (lastY < at + ENDLESS_AHEAD) {
        const level = levelAt(lastY);
        if (bunched > 0) bunched--;
        else if (made > 3 && rnd() < level * ENDLESS_QUICK) bunched = 3;
        lastY += bunched > 0 ? QUICK_GAP : Math.round(ENDLESS_GAP - ENDLESS_TIGHTEN * level);
        const side = made % 2 === 0 ? first : -first;
        const off = bunched > 0 ? QUICK_OFFSET + rnd() * 2 : POLE_OFFSET + rnd() * 4 + ENDLESS_SWING * level;
        const x = Math.round(centerAt(lastY) + side * off);
        const p = { y: lastY, x, side, pass: side, red: made > 0 && rnd() < ENDLESS_RED, result: null, fallen: 0 };
        poles.push(p);
        pts.push({ y: p.y, x: p.x + side * LINE_WIDE });
        made++;
      }
      let gone = 0;
      while (gone < nextPole && poles[gone].y < at - ENDLESS_BEHIND) gone++;
      poles.splice(0, gone);
      nextPole -= gone;
      while (pts.length > 2 && pts[1].y < at - ENDLESS_BEHIND) pts.shift();
    };
    const lineEnd = endless ? Infinity : poles[poles.length - 1].y;
    document.body.classList.toggle('night', !!S.night);
    const baseWidth = alongCourse(S.width, finishY), baseSlope = alongCourse(S.slope, finishY);
    const cherryAt = alongCourse(S.cherry, finishY), debrisAt = alongCourse(S.debris, finishY);
    // Penitentes grow in fields: patches of smooth noise, below the start.
    const penField = !S.penitentes ? () => false
      : (x, y) => y > START_PAD + 40 && noise2(x / 18 + 7, y / 18 + (salt % 37)) < 0.1 + 0.5 * S.penitentes;
    // Scree: patches of smooth noise where the snow has gone, all over the
    // slope. Ice cliffs: a band at each side, high up only.
    const screeAmt = alongCourse(S.scree, finishY), band = S.snowBand ? alongCourse(S.snowBand, finishY) : null;
    const screeAt = !S.scree ? () => false : (x, y) => {
      if (y < START_PAD - 40) return false;
      const n = noise2(x / 16 + 50, y / 16 + (salt % 53)) + 0.12 * noise2(x / 4, y / 4);
      if (band) {
        // The snow shrinks back towards the piste down the mountain, its
        // edge ragged; beyond it, bare rock with the odd snow patch left.
        const c = centerAt(y), edge = baseWidth(y) + band(y) + 18 * (noise2(y / 30, x < c ? 3.5 : 8.5) - 0.5);
        if (Math.abs(x - c) > edge) return n < 0.9;
      }
      const amt = screeAmt(y);
      return amt > 0 && n < 0.12 + 0.55 * amt;
    };
    // How far into the ice (x, y) is, past the cliff's face; 0 or less is not ice.
    const iceDepth = !S.ice ? () => -99 : (x, y) => y >= S.ice * finishY ? -99
      : Math.abs(x - centerAt(y)) - (baseWidth(y) + 30 + 6 * noise2(y / 15, 9)) - Math.max(0, y - (S.ice - 0.05) * finishY) * 2;
    const iceAt = (x, y) => iceDepth(x, y) > 0;
    const widthAt = !K ? baseWidth : y =>
      y < c0 || y > c2 ? baseWidth(y)
        : y <= c1 ? K.hw : K.hw + (baseWidth(y) - K.hw) * smooth((y - c1) / K.open);
    const slopeAt = !K ? baseSlope : y => (y >= c0 && y <= c1 ? K.slope : baseSlope(y));
    // Rock: past the gully's edge, which is a little ragged.
    const inCouloir = y => !!K && y >= c0 - 12 && y <= c2;
    // How far into the rock (x, y) is; 0 or less is the gully.
    const rockDepth = (x, y) => !K || y < c0 || y > c2 ? -1
      : Math.abs(x - centerAt(y)) - widthAt(y) - 3 * noise2(y / 6, x < centerAt(y) ? 21.5 : 37.5);
    const wall = (x, y) => rockDepth(x, y) > 0;
    // Where the slope breaks away: the start of each climb in steepness.
    const lips = typeof S.slope === 'number' ? [] : S.slope.slice(1)
      .filter((pt, k) => S.slope[k][1] <= 1 && pt[1] > 1)
      .map(pt => Math.round(S.slope[S.slope.indexOf(pt) - 1][0] * finishY))
      .concat(K ? [c0] : []);
    const borders = S.borders.map(t => Math.round(t * finishY));
    // Signs stand just off the piste on whichever side has room, bottom
    // edge on their row; worked out here so trees can keep clear.
    const signs = S.signs.map(g => ({ y: Math.round(g.t * finishY), lines: g.lines, flag: g.flag }))
      .concat(K && K.sign ? [{ y: c0, lines: K.sign }] : [])
      .map(g => {
        const wd = Math.max(...g.lines.map(l => l.length)) * 4 + 3, ht = g.lines.length * 6 + 3;
        const c = centerAt(g.y), edge = baseWidth(g.y) + 6;
        const x0 = c - edge - wd > 2 ? Math.round(c - edge - wd) : Math.round(Math.min(c + edge, W - wd - 2));
        return { ...g, wd, ht, x0, top: g.y - ht - 4 - (g.flag ? 0 : 0) };
      });
    // Base camp: tents for ten in a cluster just off the piste by the
    // finish, on the side with more room. Kept clear of trees and rocks.
    let camp = null;
    if (S.camp && !endless) {
      const cy = finishY - 18, c = centerAt(cy), edge = widthAt(cy) + EDGE_WOBBLE + 4;
      const side = c > W / 2 ? -1 : 1;
      const x = side < 0 ? Math.round(c - edge - CAMP_W) : Math.round(c + edge);
      camp = { x, y: Math.round(cy - CAMP_H / 2), w: CAMP_W, h: CAMP_H };
    }
    // Fans along both edges of the piste at the finish, mostly just past
    // the line, in columns outward when there are lots. Scenery only.
    const fans = [];
    const FAN_ROWS = [9, 18, 0, 27, 36, -9, 45, -18];
    // An arena: half an ellipse of barrier hanging below the finish line
    // from its two ends, the crowd in rows behind it.
    let arena = null;
    if (S.arena && !endless) {
      const cx = centerAt(finishY), rx = baseWidth(finishY) + 8, ry = ARENA_RY;
      arena = { cx, rx, ry, y: finishY };
      // A jostling crowd, not rows: each person somewhere in a band behind
      // the barrier, as long as they're not standing on someone else.
      // Most press up near the barrier in clumps of friends; some hang
      // back; a few wander off on their own.
      const rnd2 = mulberry32((seed % 4294967296) ^ 0xFA25);
      const clumps = Array.from({ length: 9 }, () => 0.1 + rnd2() * (Math.PI - 0.2));
      for (let k = 0, tries = 0; k < S.fans && tries < S.fans * 60; tries++) {
        const r = rnd2(), stray = r < 0.08, inClump = r > 0.35;
        const th = stray ? -0.5 + rnd2() * (Math.PI + 1)
          : inClump ? clumps[Math.floor(rnd2() * clumps.length)] + (rnd2() + rnd2() - 1) * 0.28
          : 0.04 + rnd2() * (Math.PI - 0.08);
        const d = stray ? 30 + rnd2() * 40 : 5 + (-Math.log(1 - rnd2() * 0.95)) * 9;
        const x = Math.round(cx + (rx + d) * Math.cos(th)), y = Math.round(finishY + (ry + d) * Math.sin(th)) + 4;
        if (fans.some(f => Math.abs(f.x - x) < 5 && Math.abs(f.y - y) < 6)) continue;
        fans.push({ x, y, ink: FAN_INKS[Math.floor(rnd2() * FAN_INKS.length)], phase: Math.floor(rnd2() * 8),
          camera: k < S.cameras });
        k++;
      }
      fans.sort((a, b) => a.y - b.y);   // nearer the bottom of the screen draws on top
    }
    for (let k = 0; !endless && !arena && k < S.fans; k++) {
      const side = k % 2 ? 1 : -1, m = k >> 1;
      const col = Math.floor(m / FAN_ROWS.length), fy = finishY + FAN_ROWS[m % FAN_ROWS.length] + (col % 2) * 3;
      const jit = hash(k * 131 + salt, 7) * 2;
      fans.push({ x: Math.round(centerAt(fy) + side * (widthAt(fy) + 7 + col * 7 + jit)), y: fy,
        ink: FAN_INKS[Math.floor(hash(k * 29 + salt, 11) * FAN_INKS.length)], phase: Math.floor(hash(k * 17 + salt, 3) * 8),
        camera: k < S.cameras });
    }
    // Vinson: a crowd of penguins instead, in messy huddles on both sides
    // past the line, chicks among the grown-ups, a few strays, three in a
    // bobble hat and scarf.
    if (S.penguinFans && !endless) {
      const rnd3 = mulberry32((seed % 4294967296) ^ 0xBE6);
      const huddles = Array.from({ length: 6 }, (_, h) => ({ side: h % 2 ? 1 : -1, y: finishY - 26 + rnd3() * 40, off: 12 + rnd3() * 18 }));
      for (let k = 0, tries = 0; k < PENGUIN_CROWD && tries < PENGUIN_CROWD * 60; tries++) {
        const stray = rnd3() < 0.1, h = huddles[Math.floor(rnd3() * huddles.length)];
        const y = Math.round(stray ? finishY - 34 + rnd3() * 56 : h.y + (rnd3() + rnd3() - 1) * 9);
        const off = stray ? 8 + rnd3() * 40 : h.off + (rnd3() + rnd3() - 1) * 10;
        const side = stray ? (rnd3() < 0.5 ? -1 : 1) : h.side;
        if (off < 7) continue;
        const x = Math.round(centerAt(y) + side * (widthAt(y) + off));
        const chick = rnd3() < 0.33;
        if (fans.some(f => Math.abs(f.x - x) < (chick || f.chick ? 5 : 7) && Math.abs(f.y - y) < (chick || f.chick ? 5 : 7))) continue;
        fans.push({ x, y, chick, hat: null, phase: Math.floor(rnd3() * 12), penguin: true });
        k++;
      }
      // Three dressed for the occasion, the rest as nature made them.
      fans.filter(f => !f.chick).slice(0, PENGUIN_WOOL.length).forEach((f, i) => { f.hat = PENGUIN_WOOL[i]; });
      fans.sort((a, b) => a.y - b.y);   // nearer the bottom draws on top
    }
    const fanCols = Math.ceil(S.fans / 2 / FAN_ROWS.length);
    const fanZone = (x, y) => S.penguinFans && !endless ? y > finishY - 30 && y < finishY + 66 && Math.abs(x - centerAt(y)) < widthAt(y) + 56
      : arena ? y > finishY - 40 && y < finishY + arena.ry + 80 && Math.abs(x - arena.cx) < arena.rx + 76
      : fans.length > 0 && y > finishY - 28 && y < finishY + 56 && Math.abs(x - centerAt(y)) < widthAt(y) + 15 + fanCols * 7;
    // Safety nets on the outside of the sharpest bends: the share of
    // slots that bend most, a run of net following the edge through each.
    const nets = [];
    if (S.edgeNets && !endless) {
      const bend = y => centerAt(y + 30) - 2 * centerAt(y) + centerAt(y - 30);
      const slots = [];
      for (let y = START_PAD; y + NET_LEN < finishY - 40; y += NET_LEN + 20) {
        let best = 0, at = y;
        for (let yy = y; yy < y + NET_LEN; yy += 5) if (Math.abs(bend(yy)) > Math.abs(best)) { best = bend(yy); at = yy; }
        slots.push({ y0: y, y1: y + NET_LEN, side: best > 0 ? -1 : 1, bend: Math.abs(best) });
      }
      slots.sort((a, b) => b.bend - a.bend).slice(0, Math.round(slots.length * S.edgeNets))
        .forEach(n => nets.push(n));
    }
    // The chairlift runs dead straight up whichever side the piste leaves
    // more room on.
    let liftX = null;
    if (S.lift && !endless) {
      let sum = 0, n = 0;
      for (let y = 0; y < finishY; y += 40) { sum += centerAt(y); n++; }
      liftX = sum / n > W / 2 ? 18 : W - 18;
    }
    course = { seed, centerAt, lineAt, poles, finishY, salt, nets, liftX, titlePine, endless, lineEnd, extend, levelAt, widthAt, slopeAt, lips, borders, signs, arena, wall, rockDepth, inCouloir, camp, fans, fanZone,
      couloir: K ? { c0, c1, c2 } : null, cherryAt, debrisAt, screeAt, iceAt, iceDepth, penField, shape: S };
    if (endless) extend(0);
    snowRows.clear();            // cached rows belong to the previous slope
  }

  // ------------------------------------------------------------ supabase io
  // Same Supabase project as snake-bit, so the same encoded credential blob.
  // Obfuscation, not security: the anon key is public by design; the real
  // protection is that every write goes through an RPC that validates
  // against the server's clock and the server's seed.
  function juiceFromPeel(peel) {
    try {
      const pulp = atob(peel);
      let nectar = '';
      for (let i = 0; i < pulp.length; i++) {
        nectar += String.fromCharCode((pulp.charCodeAt(i) - 13 + 256) % 256);
      }
      return nectar;
    } catch (_) {
      return null;
    }
  }
  const crate = document.getElementById('pineappl');
  const fresh = crate ? juiceFromPeel(crate.textContent.trim()) : null;
  const [zest, pulp] = (fresh || '|').split('|');
  const lib = window.supabase;
  const juicer = (lib && zest && pulp) ? lib.createClient(zest, pulp) : null;

  // ------------------------------------------------------------------- dom
  const canvas = document.getElementById('screen');
  const ctx = canvas.getContext('2d');
  canvas.width = VW; canvas.height = H;
  const img = ctx.createImageData(VW, H);
  document.body.classList.toggle('narrow', NARROW);

  const scoreEl = document.getElementById('hud-score');
  const missEl = document.getElementById('hud-miss');
  const missBoxEl = document.getElementById('hud-miss-box');
  const missLabelEl = document.getElementById('hud-miss-label');
  const bestEl = document.getElementById('hud-best');
  const msgEl = document.getElementById('message');
  const overlayEl = document.getElementById('overlay');
  const overlayTitleEl = document.getElementById('overlay-title');
  const overlayWordEl = document.getElementById('overlay-word');
  const finalScoreEl = document.getElementById('final-score-val');
  const finalStarsEl = document.getElementById('final-stars');
  const leaderboardEl = document.getElementById('leaderboard');
  const finalScoreRowEl = document.getElementById('final-score');
  const againRowEl = document.getElementById('again-row');
  const restartHintEl = document.getElementById('restart-hint');
  const closeRowEl = document.getElementById('close-row');
  const boardBtnEl = document.getElementById('board-btn');
  const pauseBtnEl = document.getElementById('pause-btn');
  const restartBtnEl = document.getElementById('restart-btn');
  const breakdownEl = document.getElementById('breakdown');
  const runPisteEl = document.getElementById('run-piste');
  let singleIntro = null;   // the Single mountain whose card is up, before its run
  const submitFormEl = document.getElementById('submit-form');
  const initialsInputEl = document.getElementById('initials-input');
  const submitBtnEl = document.getElementById('submit-btn');
  const skipBtnEl = document.getElementById('skip-btn');
  const submitStatusEl = document.getElementById('submit-status');
  const leaderboardListEl = document.getElementById('leaderboard-list');
  const newTopEl = document.getElementById('new-top');
  const boardTitleEl = leaderboardEl.querySelector('h3');
  const againBtnEl = document.getElementById('again-btn');
  const titleCardEl = document.getElementById('title-card');
  const bonusEl = document.getElementById('bonus');
  const countdownEl = document.getElementById('countdown');
  const bonusTimeEl = document.getElementById('bonus-time');
  const bonusPointsEl = document.getElementById('bonus-points');
  const bonusScoreEl = document.getElementById('bonus-score');

  // ------------------------------------------------------------ run state
  // 'title' -> 'starting' -> 'countdown' -> 'running' <-> 'paused'
  //                                      'running' -> 'crashed' | 'finished'
  let state = 'title';
  let skierX, skierY, vx, speed, mode;
  let straightFor = 0;         // seconds since the skier last steered
  let passed, missed, reds, clips, nextPole;
  let streak = 0, streaks = [], clipPoints = 0;   // the combo, see COMBO_CAP
  let burned = { pine: 0, tree: 0, fence: 0 };     // blown up on fire
  let survived = { fox: 0, wolf: 0, bear: 0 };     // chases that gave up
  let forgiven = 0;   // misses a pineapple smashed on fire took back
  // The Konami code's god mode: on fire from the start of every run and
  // never going out, blue so it's never mistaken for the real thing.
  // Same rules otherwise, but fire not earned isn't ranked.
  let godMode = false;
  // The mode the current run's session was issued in; fire, sounds, the
  // card and the save all go by this, not by the setting.
  let runGod = false;
  const onFire = () => runGod || streak >= FIRE_AT;
  let runStart = 0, runEnd = null;
  let hitWhat = 'TREES';       // what ended a crashed run, for the card
  let sluff = null;            // the loose snow pouring down a couloir behind you
  let heli = null;             // the helicopter that drops you off, if there is one
  let crossed = 0;             // borders crossed so far this run
  let fellIn = false;          // swallowed by a crevasse: no skier left to draw
  let slide = null;            // an avalanche on the way down, if there is one
  let snowballs = [];          // ...and what it breaks up into near the end: rolling, then lumps
  let icefall = [], iceIn = 0; // chunks off a serac, sliding across the piste
  // Championship courses are fixed, so where the animals turn up is
  // shuffled per run instead; Single's come from its seed as ever.
  let animalSalt = 0;
  let runClassic = null;       // a Single run on a mountain's course: its id
  let exploded = new Set();    // pineapples already blown up, by cell
  // Trees and fences set alight on fire, by the same keys, each with when
  // and in which fire's colours. A tree hit is a stump; a tree passed burns
  // and chars; a fence hit burns outward from the gap it was hit at.
  let scorched = new Map();
  let particles = [];
  // Turn while a key is held, straighten when it's let go. The newest
  // held key wins, and a tap still commits a short turn so it isn't lost.
  let heading = 'down';        // 'left' | 'down' | 'right'
  let held = [];               // [{ id, dir }], newest last
  let tapDir = 'down', tapLeft = 0;

  // ----------------------------------------------------------------- sound
  // Built like snake-bit's: one AudioContext created on the first key or
  // tap (browsers refuse audio before that), everything through a master
  // gain so M can mute it all. All noise, no music: the slope hisses under
  // the skis, turns snap, and the ends of runs are wood or pineapple.
  const SFX = (() => {
    const AC = window.AudioContext || window.webkitAudioContext;
    let ac = null, master = null, noise = null, swoosh = null, hiss = null, rotor = null;
    let muted = false;
    try { muted = localStorage.getItem('slalom_muted') === '1'; } catch (_) {}
    const VOLUME = 0.45;

    function unlock() {
      if (!AC) return;
      if (!ac) {
        ac = new AC();
        master = ac.createGain();
        master.gain.value = muted ? 0 : VOLUME;
        master.connect(ac.destination);
        // Two seconds of white noise, shared by every sound below.
        noise = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
        const d = noise.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      if (ac.state === 'suspended') ac.resume().catch(() => {});
    }

    function noiseThrough(type, freq, q, at) {
      const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
      src.buffer = noise;
      src.loopStart = 0; src.loopEnd = noise.duration;
      // Start somewhere random in the buffer so repeats don't sound identical.
      const offset = Math.random() * (noise.duration - 0.5);
      f.type = type; f.frequency.value = freq; f.Q.value = q;
      src.connect(f); f.connect(g); g.connect(master);
      src.start(at, offset);
      return { src, f, g };
    }

    // The skis on the snow: looping noise whose loudness and brightness
    // follow speed; deep snow muffles it. Loudest running straight at full
    // tuck; carving across the slope it eases down to half, which also
    // leaves room for the coin on a clip.
    function startSwoosh() {
      if (!ac) return;
      stopSwoosh();
      swoosh = noiseThrough('bandpass', 800, 0.6, ac.currentTime);
      swoosh.src.loop = true;
      swoosh.g.gain.value = 0;
    }
    function updateSwoosh(speedNorm, depth, steering) {
      if (!swoosh) return;
      const t = ac.currentTime;
      const v = Math.max(0, Math.min(1.6, speedNorm));
      swoosh.g.gain.setTargetAtTime((0.03 + 0.12 * v) * (steering ? 0.5 : 1), t, 0.1);
      swoosh.f.frequency.setTargetAtTime(500 + 2600 * Math.min(1.2, v) * (1 - 0.65 * depth), t, 0.06);
    }
    function stopSwoosh() {
      if (!swoosh) return;
      const t = ac.currentTime, sw = swoosh;
      sw.g.gain.setTargetAtTime(0, t, 0.05);
      sw.src.stop(t + 0.3);
      swoosh = null;
    }

    // The sluff: a low rushing hiss that swells as it closes on you
    // (level 0..1); 0 lets it die away.
    function updateSluff(level) {
      if (!ac) return;
      const t = ac.currentTime;
      if (level > 0 && !hiss) {
        hiss = noiseThrough('lowpass', 900, 0.7, t);
        hiss.src.loop = true;
        hiss.g.gain.value = 0;
      }
      if (!hiss) return;
      hiss.g.gain.setTargetAtTime(0.22 * level, t, 0.15);
      hiss.f.frequency.setTargetAtTime(500 + 1400 * level, t, 0.15);
      if (level <= 0) { const h = hiss; h.src.stop(t + 0.8); hiss = null; }
    }

    // A little propeller plane: a buzzing drone that swells and fades,
    // rising a touch as it goes, for `dur` seconds.
    function playFlight(dur) {
      if (!ac) return;
      const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain(), lfo = ac.createOscillator(), lg = ac.createGain();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(95, t);
      o.frequency.linearRampToValueAtTime(130, t + dur);
      lfo.frequency.value = 22; lg.gain.value = 0.04;
      lfo.connect(lg); lg.connect(g.gain);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.07, t + dur * 0.3);
      g.gain.linearRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(master); o.start(t); lfo.start(t); o.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
    }

    // Ice breaking off: a sharp crack.
    function playCrack() {
      if (!ac) return;
      const t = ac.currentTime, n = noiseThrough('highpass', 3000, 0.7, t);
      n.g.gain.setValueAtTime(0.25, t);
      n.g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
      n.src.stop(t + 0.08);
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'square'; o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(60, t + 0.12);
      g.gain.setValueAtTime(0.1, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.14);
    }

    // An avalanche: a deep rumble that swells to a roar.
    let roar = null;
    function updateAvalanche(level) {
      if (!ac) return;
      const t = ac.currentTime;
      if (level > 0 && !roar) {
        roar = noiseThrough('lowpass', 140, 1.4, t);
        roar.src.loop = true;
        roar.g.gain.value = 0;
      }
      if (!roar) return;
      roar.g.gain.setTargetAtTime(0.55 * level, t, 0.2);
      roar.f.frequency.setTargetAtTime(110 + 380 * level, t, 0.2);
      if (level <= 0) { const r = roar; r.src.stop(t + 1.2); roar = null; }
    }

    // Into a crevasse: a long falling whistle, then a faint, far-off thump.
    function playFall() {
      if (!ac) return;
      const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(900, t);
      o.frequency.exponentialRampToValueAtTime(110, t + 0.9);
      g.gain.setValueAtTime(0.16, t);
      g.gain.exponentialRampToValueAtTime(0.02, t + 0.9);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 1.01);
      const th = ac.createOscillator(), tg = ac.createGain();
      th.type = 'sine'; th.frequency.setValueAtTime(70, t + 1.05);
      tg.gain.setValueAtTime(0.0001, t + 1.05);
      tg.gain.exponentialRampToValueAtTime(0.12, t + 1.07);
      tg.gain.exponentialRampToValueAtTime(0.0001, t + 1.25);
      th.connect(tg); tg.connect(master); th.start(t + 1.05); th.stop(t + 1.26);
    }

    // The wind: a band of noise that swells and brightens with the gust.
    let gale = null;
    function updateWind(level) {
      if (!ac) return;
      const t = ac.currentTime;
      if (level > 0 && !gale) {
        gale = noiseThrough('bandpass', 500, 0.6, t);
        gale.src.loop = true;
        gale.g.gain.value = 0;
      }
      if (!gale) return;
      gale.g.gain.setTargetAtTime(0.28 * level, t, 0.12);
      gale.f.frequency.setTargetAtTime(350 + 1100 * level, t, 0.12);
      if (level <= 0) { const w = gale; w.src.stop(t + 0.8); gale = null; }
    }

    // A dog's bark: two quick, rough yaps.
    function playBark() {
      if (!ac) return;
      const t = ac.currentTime;
      [0, 0.16].forEach(d => {
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = 'square';
        o.frequency.setValueAtTime(420, t + d);
        o.frequency.exponentialRampToValueAtTime(240, t + d + 0.09);
        g.gain.setValueAtTime(0.0001, t + d);
        g.gain.exponentialRampToValueAtTime(0.12, t + d + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.1);
        o.connect(g); g.connect(master); o.start(t + d); o.stop(t + d + 0.11);
      });
    }

    // Skis on bare rock: a short, harsh scrape of high noise.
    function playScrape(level) {
      if (!ac) return;
      const t = ac.currentTime, n = noiseThrough('highpass', 2400 + Math.random() * 1500, 0.8, t);
      n.g.gain.setValueAtTime(0.12 * (0.4 + 0.6 * level), t);
      n.g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
      n.src.stop(t + 0.09);
    }

    // A helicopter: low noise chopped by a square wave, thup-thup-thup,
    // at `level` 0..1; 0 lets it die away.
    function updateHeli(level) {
      if (!ac) return;
      const t = ac.currentTime;
      if (level > 0 && !rotor) {
        rotor = noiseThrough('lowpass', 380, 1.2, t);
        rotor.src.loop = true;
        rotor.g.gain.value = 0;
        const lfo = ac.createOscillator(), depth = ac.createGain();
        lfo.type = 'square'; lfo.frequency.value = 11;
        depth.gain.value = 0;
        lfo.connect(depth); depth.connect(rotor.g.gain);
        lfo.start(t);
        rotor.lfo = lfo; rotor.depth = depth;
      }
      if (!rotor) return;
      rotor.g.gain.setTargetAtTime(0.2 * level, t, 0.1);
      rotor.depth.gain.setTargetAtTime(0.18 * level, t, 0.1);
      if (level <= 0) { const r = rotor; r.src.stop(t + 0.6); r.lfo.stop(t + 0.6); rotor = null; }
    }

    // A change of direction: a short dash of noise sweeping down.
    function playDash(strength) {
      if (!ac) return;
      const t = ac.currentTime;
      const { src, f, g } = noiseThrough('bandpass', 4500, 1.2, t);
      f.frequency.setValueAtTime(4500, t);
      f.frequency.exponentialRampToValueAtTime(900, t + 0.12);
      g.gain.setValueAtTime(0.28 * strength, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      src.stop(t + 0.15);
    }

    // Into a tree: boxes breaking. A low thud, then a handful of dry
    // cracks tumbling after it, each with a little wooden knock.
    function playBreak() {
      if (!ac) return;
      const t = ac.currentTime;
      const thud = ac.createOscillator(), tg = ac.createGain();
      thud.type = 'sine';
      thud.frequency.setValueAtTime(140, t);
      thud.frequency.exponentialRampToValueAtTime(45, t + 0.18);
      tg.gain.setValueAtTime(0.4, t);
      tg.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      thud.connect(tg); tg.connect(master); thud.start(t); thud.stop(t + 0.21);
      [0, 0.035, 0.08, 0.13, 0.2, 0.29].forEach((dt, k) => {
        const at = t + dt + Math.random() * 0.015;
        const len = 0.04 + Math.random() * 0.03;
        const { src, g } = noiseThrough('bandpass', 1200 + Math.random() * 2000, 3, at);
        g.gain.setValueAtTime(0.3 * (1 - k * 0.1), at);
        g.gain.exponentialRampToValueAtTime(0.001, at + len);
        src.stop(at + len + 0.01);
        const knock = ac.createOscillator(), kg = ac.createGain();
        knock.type = 'square';
        knock.frequency.value = 200 + Math.random() * 200;
        kg.gain.setValueAtTime(0.06, at);
        kg.gain.exponentialRampToValueAtTime(0.001, at + 0.03);
        knock.connect(kg); kg.connect(master); knock.start(at); knock.stop(at + 0.04);
      });
    }

    // snake-bit's pineapple explosion, unchanged: noise burst + pitch drop.
    function playExplosion() {
      if (!ac) return;
      const t = ac.currentTime;
      const { src, g: ng } = noiseThrough('allpass', 1000, 1, t);
      ng.gain.setValueAtTime(0.35, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      src.stop(t + 0.31);
      const osc = ac.createOscillator(), g = ac.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(300, t); osc.frequency.exponentialRampToValueAtTime(40, t + 0.25);
      g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      osc.connect(g); g.connect(master); osc.start(t); osc.stop(t + 0.26);
    }

    // A fork: a hard wooden clack, skis on the wrong side of the pole.
    function playClack() {
      if (!ac) return;
      const t = ac.currentTime;
      const { src, g: ng } = noiseThrough('bandpass', 1800, 4, t);
      ng.gain.setValueAtTime(0.5, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
      src.stop(t + 0.07);
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(700, t); o.frequency.exponentialRampToValueAtTime(300, t + 0.05);
      g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.08);
    }

    // You've made the top 10: a quick lift, before the initials.
    function playQualify() {
      if (!ac) return;
      const t = ac.currentTime;
      [659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => note(f, t + i * 0.09, i === 3 ? 0.35 : 0.08, 0.1, 'square'));
    }

    // The end of an Endless run, however it ended: a climb, then a proper
    // cadence, because getting this far deserves one.
    function playRunOver() {
      if (!ac) return;
      const t = ac.currentTime;
      [392, 523.25, 659.25, 783.99, 1046.5].forEach((f, i) => note(f, t + i * 0.11, 0.1, 0.12, 'square'));
      const iv = t + 0.6, I = t + 0.95;
      [349.23, 440, 698.46].forEach(f => note(f, iv, 0.32, 0.07, 'square'));
      note(87.31, iv, 0.32, 0.16, 'triangle');
      [392, 523.25, 659.25, 1046.5].forEach(f => note(f, I, 1.1, 0.07, 'square'));
      note(130.81, I, 1.1, 0.18, 'triangle');
    }

    // A bear has seen you: a low growl, so you know before it arrives.
    function playGrowl() {
      if (!ac) return;
      const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(95, t); o.frequency.exponentialRampToValueAtTime(55, t + 0.4);
      g.gain.setValueAtTime(0.3, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.46);
    }

    // Endless, down to the last miss: a quick alarm, high-low, once.
    function playBlips() {
      if (!ac) return;
      const t = ac.currentTime;
      [1480, 1110, 1480, 1110, 1480, 1110].forEach((f, i) => note(f, t + i * 0.075, 0.06, 0.11, 'square'));
    }

    // Catching fire: a whoosh, noise swelling as it rises, over a low roar.
    function playIgnite() {
      if (!ac) return;
      const t = ac.currentTime;
      const { src, f, g: ng } = noiseThrough('bandpass', 300, 1.2, t);
      f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(3200, t + 0.45);
      ng.gain.setValueAtTime(0.001, t); ng.gain.exponentialRampToValueAtTime(0.4, t + 0.25);
      ng.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
      src.stop(t + 0.71);
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(55, t); o.frequency.exponentialRampToValueAtTime(110, t + 0.4);
      g.gain.setValueAtTime(0.001, t); g.gain.exponentialRampToValueAtTime(0.2, t + 0.2);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.61);
    }

    // Then the power-up: quick arpeggios climbing a step at a time, a
    // shimmer on top. Starts as the whoosh peaks.
    function playPowerUp() {
      if (!ac) return;
      const t = ac.currentTime + 0.3;
      const steps = [[392, 493.88, 587.33], [440, 554.37, 659.25], [493.88, 622.25, 739.99], [523.25, 659.25, 783.99]];
      steps.forEach((chord, i) => chord.forEach((f, j) => note(f, t + (i * 3 + j) * 0.045, 0.045, 0.09, 'square')));
      const top = t + 12 * 0.045;
      note(1046.5, top, 0.3, 0.08, 'square');
      note(1567.98, top + 0.05, 0.25, 0.04, 'triangle');
    }

    // A miss forgiven: a bright little run that leaps upward, an extra
    // life's feeling without its tune.
    function playForgiven() {
      if (!ac) return;
      const t = ac.currentTime + 0.12;
      [783.99, 1046.5, 1318.5, 1174.66, 1567.98, 2093].forEach((f, i) => note(f, t + i * 0.085, i === 5 ? 0.22 : 0.07, 0.09, 'square'));
    }

    // The fire going out: a short phoop, muffling as it drops.
    function playDouse() {
      if (!ac) return;
      const t = ac.currentTime;
      const { src, f, g: ng } = noiseThrough('lowpass', 2400, 0.8, t);
      f.frequency.setValueAtTime(2400, t); f.frequency.exponentialRampToValueAtTime(120, t + 0.25);
      ng.gain.setValueAtTime(0.35, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      src.stop(t + 0.31);
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(200, t); o.frequency.exponentialRampToValueAtTime(60, t + 0.15);
      g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.19);
    }

    // Crossing the line: a quick rising arpeggio, then the chord held.
    function playFanfare() {
      if (!ac) return;
      const t = ac.currentTime;
      const note = (f, at, len, vol, type) => {
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = type; o.frequency.value = f;
        g.gain.setValueAtTime(vol, at);
        g.gain.exponentialRampToValueAtTime(0.001, at + len);
        o.connect(g); g.connect(master); o.start(at); o.stop(at + len + 0.01);
      };
      const C = [523.25, 659.25, 783.99, 1046.5];       // C5 E5 G5 C6
      C.forEach((f, i) => note(f, t + i * 0.09, 0.08, 0.12, 'square'));
      const held = t + 0.36;
      C.forEach(f => note(f, held, 0.7, 0.05, 'square'));
      note(130.81, held, 0.7, 0.14, 'triangle');      // C3 underneath
    }

    const note = (f, at, len, vol, type) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type; o.frequency.value = f;
      g.gain.setValueAtTime(vol, at);
      g.gain.exponentialRampToValueAtTime(0.001, at + len);
      o.connect(g); g.connect(master); o.start(at); o.stop(at + len + 0.01);
    };

    // A clip: snake-bit's coin, itself the Super Mario Bros. one, a square
    // wave with a hard step from B5 up to E6. A combo raises it a semitone
    // a step, so the cap is an octave up.
    function playCoin(step = 1) {
      if (!ac) return;
      const t = ac.currentTime, up = Math.pow(2, (step - 1) / 12);
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'square';
      o.frequency.setValueAtTime(988 * up, t);
      o.frequency.setValueAtTime(1319 * up, t + 0.065);
      g.gain.setValueAtTime(0.15, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.19);
    }

    // The countdown: a short low beep for 3, 2 and 1, a longer high one
    // for GO.
    function playCount(isGo) {
      if (!ac) return;
      note(isGo ? 880 : 440, ac.currentTime, isGo ? 0.4 : 0.15, 0.12, 'square');
    }

    // The bonus counting up: a blip per step, climbing as it goes.
    function playTick(progress) {
      if (!ac) return;
      note(500 + 1100 * progress, ac.currentTime, 0.035, 0.07, 'square');
    }
    // The count lands.
    function playDing() {
      if (!ac) return;
      const t = ac.currentTime;
      note(1567.98, t, 0.6, 0.1, 'triangle');          // G6
      note(2093.0, t + 0.06, 0.7, 0.07, 'triangle');   // C7
    }
    // Too slow for any bonus: a deflated two-note bwomp.
    function playNoBonus() {
      if (!ac) return;
      const t = ac.currentTime;
      note(196, t, 0.18, 0.12, 'square');
      note(147, t + 0.2, 0.35, 0.12, 'square');
    }
    // Each star a step higher, with a little shimmer of noise.
    function playStar(n) {
      if (!ac) return;
      const t = ac.currentTime, f = [1318.5, 1567.98, 2093.0][n - 1] || 2093.0;
      note(f, t, 0.09, 0.1, 'square');
      note(f * 1.5, t + 0.07, 0.25, 0.07, 'square');
      const { src, g } = noiseThrough('highpass', 6000, 0.7, t);
      g.gain.setValueAtTime(0.08, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      src.stop(t + 0.26);
    }
    // Three stars: a bouncy run up and down and up, then a big chord.
    function playJingle() {
      if (!ac) return;
      const t = ac.currentTime + 0.3;
      const run = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5, 1318.5, 1567.98];
      run.forEach((f, i) => note(f, t + i * 0.08, 0.07, 0.1, 'square'));
      const end = t + run.length * 0.08;
      [1046.5, 1318.5, 1567.98, 2093.0].forEach(f => note(f, end, 0.9, 0.05, 'square'));
      note(261.63, end, 0.9, 0.14, 'triangle');
      [0, 0.12, 0.24, 0.36].forEach(d => note(3135.96, end + d, 0.05, 0.04, 'square'));
    }

    function toggleMute() {
      muted = !muted;
      try { localStorage.setItem('slalom_muted', muted ? '1' : '0'); } catch (_) {}
      if (master) master.gain.value = muted ? 0 : VOLUME;
      return muted;
    }

    // Sound is called from inside the physics step; a browser audio fault
    // must never be able to stop a run, so every entry point swallows it.
    const safe = f => (...a) => { try { return f(...a); } catch (_) { return undefined; } };
    return {
      unlock: safe(unlock), playFlight: safe(playFlight), playCrack: safe(playCrack), updateAvalanche: safe(updateAvalanche), playFall: safe(playFall), updateWind: safe(updateWind), playScrape: safe(playScrape), playBark: safe(playBark), updateSluff: safe(updateSluff), updateHeli: safe(updateHeli), startSwoosh: safe(startSwoosh), updateSwoosh: safe(updateSwoosh),
      stopSwoosh: safe(stopSwoosh), playDash: safe(playDash), playBreak: safe(playBreak),
      playExplosion: safe(playExplosion), playFanfare: safe(playFanfare), toggleMute: safe(toggleMute),
      playCoin: safe(playCoin), playCount: safe(playCount), playTick: safe(playTick), playDing: safe(playDing), playNoBonus: safe(playNoBonus),
      playStar: safe(playStar), playJingle: safe(playJingle),
      playIgnite: safe(playIgnite), playDouse: safe(playDouse), playPowerUp: safe(playPowerUp), playForgiven: safe(playForgiven), playClack: safe(playClack), playBlips: safe(playBlips), playRunOver: safe(playRunOver), playQualify: safe(playQualify), playGrowl: safe(playGrowl),
    };
  })();

  // --------------------------------------------------------- session edges
  // The title screen already shows the real course, so the session opens
  // with the title: that's when the server hands out the seed. Its clock
  // only starts on Space (slalom_go), and it stamps pauses itself, so the
  // time spent waiting or paused never counts. Every edge goes through one
  // chain, so they reach the server in order.
  let sessionId = null, endPromise = null, edges = Promise.resolve();
  let prepared = Promise.resolve();   // settles once the next course is built

  // Each run's session is normal or GOD MODE, fixed when it's issued.
  // Switching on the title asks again; an answer to an older ask is
  // dropped, so the session is always the kind last asked for.
  let sessionGod = false, prepareSeq = 0;
  // A Single run on a mountain asks for that mountain's session instead
  // (its course is fixed, so no seed comes back: 0).
  async function openSession(seq, endless = false, classic = null) {
    sessionId = null;
    endPromise = null;
    edges = Promise.resolve();
    sessionGod = godMode;
    if (juicer) {
      try {
        const { data, error } = await (classic ? juicer.rpc('slalom_start_course', { p_course: classic, p_god: sessionGod })
          : endless ? juicer.rpc('slalom_start_endless', { p_god: sessionGod })
          : juicer.rpc(sessionGod ? 'slalom_start_god_game' : 'slalom_start_game'));
        if (seq !== prepareSeq) return 0;
        if (!error && data && data.session) {
          sessionId = data.session;
          return Number(data.seed || 0);
        }
      } catch (_) { /* fall through to an unranked run */ }
    }
    return Math.floor(Math.random() * 2 ** 40);
  }

  // A failed edge just leaves the run unranked: the server turns the score
  // down at submit.
  function tellServer(fn) {
    if (!juicer || !sessionId) return edges;
    const id = sessionId;
    edges = edges.then(() => juicer.rpc(fn, { p_session: id })).then(() => {}, () => {});
    return edges;
  }

  function closeSession() {
    endPromise = tellServer('slalom_end_game');
  }

  // What the server checks a run by (initials added when there are some).
  const runPayload = () => ({
    score: points(),
    time_cs: runCs(),
    passed, missed, reds, clips,
    streaks: streak ? [...streaks, streak] : streaks,
    forgiven,
    burned,
    survived,
    finished: state === 'finished',
  });

  // Frozen at the end of the run. In snake-bit this once ran until submit,
  // so the reported time silently absorbed initials-typing time.
  const runCs = () =>
    Math.round(((runEnd !== null ? runEnd : performance.now()) - runStart - pausedMs) / 10);

  // Everything but the time bonus, which counts up separately at the end.
  const earned = () =>
    passed * POLE_POINTS + reds * RED_POINTS + clipPoints +
    burned.pine * BURN_POINTS.pine + burned.tree * BURN_POINTS.tree + burned.fence * BURN_POINTS.fence +
    survived.fox * ANIMALS.fox.bonus + survived.wolf * ANIMALS.wolf.bonus + survived.bear * ANIMALS.bear.bonus +
    (state === 'finished' ? FINISH_POINTS : 0);
  const bonusCs = () => runCs() + missed * MISS_CS;
  const timeBonus = () =>
    missed > MISS_LIMIT ? 0 : Math.max(0, (course.shape.par - bonusCs()) * BONUS_PER_CS);
  const points = () => earned() + (state === 'finished' ? timeBonus() : 0);
  function stars() {
    if (state !== 'finished') return 0;
    if (missed <= 0 && runCs() <= course.shape.star3) return 3;
    if (missed <= STAR2_MISSES && bonusCs() < course.shape.par) return 2;
    return 1;
  }

  const fmt = cs => {
    const neg = cs < 0; cs = Math.abs(cs);
    return (neg ? '-' : '') + Math.floor(cs / 100) + '.' + String(cs % 100).padStart(2, '0');
  };

  // ---------------------------------------------------------------- flow
  // The title screen is the top of the next course, built from the seed as
  // soon as the server sends it. Until then, a stand-in slope.
  function prepareRun() {
    const seq = ++prepareSeq;
    course = null;
    snowRows.clear();
    prepared = openSession(seq).then(seed => {
      if (seq !== prepareSeq) return;
      buildCourse(seed);
      skierX = course.centerAt(0);
      skierY = 0;
    });
  }

  // After a run, back to the title and the instructions, on a new course.
  // keep: between Championship courses, where no title or new session is
  // wanted, only a clean slate for the next run.
  function toTitle(keep = false) {
    state = 'title';
    ranOut = false;
    // The last run's weather and wildlife go with it.
    sluff = null; slide = null; snowballs = []; heli = null; icefall = []; wind = null; gustLines = []; fellIn = false; pan = 0;
    if (!keep) { champ = null; prepareRun(); }
    particles = [];
    hideOverlay();
    titleCardEl.hidden = keep;
    countdownEl.hidden = true;
    tally = null;
    shownBonus = 0;
    bonusEl.hidden = true;
    passed = 0; missed = 0; reds = 0; clips = 0; nextPole = 0;
    streak = 0; streaks = []; clipPoints = 0; burned = { pine: 0, tree: 0, fence: 0 };
    survived = { fox: 0, wolf: 0, bear: 0 }; forgiven = 0;
    msgEl.textContent = '';
    paintHud();
  }

  // Bumped by every run, so a card or tally queued by the last one can
  // tell it's been restarted out from under it.
  let runId = 0;

  async function startRun() {
    if (state !== 'title') return;
    state = 'starting';
    runId++;
    hideOverlay();
    titleCardEl.hidden = true;
    flash('GET READY');
    await prepared;
    runGod = sessionGod;
    // Endless has its own kind of session, asked for now rather than on the
    // title, and the slope that comes with it.
    if (chosenMode() === 'endless') {
      buildCourse(await openSession(prepareSeq, true), true);
      runGod = sessionGod;
    } else if (champ) {   // its own session, checked the moment it's over
      buildCourse(champ.current.seed, false, shapeOf(champ.current));
      await openChampSession();
      runGod = champ.god;
    }
    // Single on a mountain: its Championship course, on its own session
    // and board.
    runClassic = !champ && chosenMode() === 'single' ? classicPick() : null;
    if (runClassic) {
      const m = mountain(runClassic);
      await openSession(prepareSeq, false, runClassic);
      buildCourse(m.seed, false, shapeOf(m));
      runGod = sessionGod;
    }
    skierX = course.centerAt(0);
    skierY = 0;
    vx = 0; speed = 0; mode = 'down'; straightFor = 0; heading = 'down';
    held = []; tapLeft = 0;
    hitWhat = 'TREES'; exploded = new Set(); scorched = new Map(); particles = []; sluff = null; heli = null; crossed = 0; pan = 0; wind = null; gustLines = []; fellIn = false; slide = null; snowballs = []; icefall = []; iceIn = 0.5;
    animalSalt = champ || runClassic ? Math.floor(Math.random() * 999983) : 0;
    animals = []; animalSlot = Math.ceil(START_PAD / ANIMAL_SLOT);
    birds = []; birdIn = between(course.endless ? BIRD_EVERY_ENDLESS : BIRD_EVERY);
    moths = []; mothIn = 2; petals = [];
    passed = 0; missed = 0; reds = 0; clips = 0; nextPole = 0;
    streak = 0; streaks = []; clipPoints = 0; burned = { pine: 0, tree: 0, fence: 0 };
    survived = { fox: 0, wolf: 0, bear: 0 }; forgiven = 0;
    shownBonus = 0;
    runEnd = null;
    pausedMs = 0;
    paintHud();
    // 3, 2, 1 with the skier standing at the top, then GO. Neither clock
    // starts until GO.
    msgEl.classList.add('above-count');
    flash("GOOD LUCK, YOU'RE GONNA NEED IT", 3 * COUNT_BEAT_MS);
    state = 'countdown';
    if (course.shape.heli) heli = { x: Math.round(skierX), y: Math.round(skierY) - 22, leftAt: null };
    const id = runId;
    const beat = n => {
      if (runId !== id || state !== 'countdown') return;
      if (n === 0) { go(); return; }
      showCount(String(n));
      SFX.playCount(false);
      setTimeout(() => beat(n - 1), COUNT_BEAT_MS);
    };
    beat(3);
  }

  const COUNT_BEAT_MS = 1000;
  function showCount(text) {
    countdownEl.textContent = text;
    countdownEl.hidden = false;
  }

  function go() {
    msgEl.classList.remove('above-count');
    tellServer('slalom_go');
    runStart = performance.now();
    // Physics and clock share an origin; nothing before this moment counts.
    last = runStart;
    acc = 0;
    state = 'running';
    if (heli) heli.leftAt = performance.now();   // off it goes
    SFX.startSwoosh();
    SFX.playCount(true);
    showCount('GO!');
    if (runGod) { flash('GOD MODE'); SFX.playIgnite(); SFX.playPowerUp(); }
    else if (!sessionId) flash('UNRANKED');
    const id = runId;
    setTimeout(() => { if (runId === id) countdownEl.hidden = true; }, 700);
  }

  // R: drop this run, unscored, and go again at once on a new course. The
  // seed is spent with its session, so it can't be the same course.
  function restart() {
    if (state === 'starting') return;
    if (champ) {   // R restarts the whole Championship
      if (state === 'running' || state === 'paused') { runEnd = performance.now(); SFX.stopSwoosh(); closeSession(); }
      toTitle(true);
      startChampionship();
      return;
    }
    if (state === 'title') { startChosen(); return; }   // already a fresh course
    if (state === 'running' || state === 'paused') {
      runEnd = performance.now();
      SFX.stopSwoosh();
      closeSession();
    }
    toTitle();
    startRun();
  }

  // Space mid-run: the run freezes where it is, PAUSED over it.
  let pausedMs = 0, pausedAt = 0;
  function togglePause() {
    if (state === 'running') {
      state = 'paused';
      pausedAt = performance.now();
      straighten();
      SFX.stopSwoosh();
      tellServer('slalom_pause');
      msgEl.textContent = 'PAUSED';
    } else if (state === 'paused') {
      state = 'running';
      pausedMs += performance.now() - pausedAt;
      tellServer('slalom_resume');
      SFX.startSwoosh();
      msgEl.textContent = '';
    }
  }

  function crash(hit) {
    state = 'crashed';
    mode = 'crash';
    runEnd = performance.now();
    hitWhat = hit.icefall ? 'ICEFALL' : hit.avalanche ? 'AVALANCHE' : hit.crevasse ? 'CREVASSE' : hit.ice ? 'ICE' : hit.pen ? 'PENITENTES' : hit.sluff ? 'SLUFF' : hit.wall || hit.rock ? 'ROCKS' : hit.tent ? 'TENTS' : hit.net ? 'NETS' : hit.animal ? hit.kind.toUpperCase() : hit.pine ? 'PINEAPPLE' : hit.fence ? 'FENCE' : 'TREES';
    SFX.stopSwoosh();
    if (hit.avalanche) {   // swallowed: the snow rolls on over you
      fellIn = true;
      slide.y = skierY + 6;
      for (let k = 0; k < 18; k++) particles.push({ x: skierX + (Math.random() - 0.5) * 10, y: skierY, vx: (Math.random() - 0.5) * 60,
        vy: -20 - Math.random() * 40, g: 120, life: 0.4 + Math.random() * 0.4, size: 1, color: Math.random() < 0.6 ? VIC.white : VIC.lightBlue });
      SFX.playBreak();
    } else if (hit.crevasse) {   // gone: a puff of snow and a long fall
      fellIn = true;
      SFX.playFall();
      for (let k = 0; k < 14; k++) particles.push({ x: skierX + (Math.random() - 0.5) * 6, y: skierY - 2, vx: (Math.random() - 0.5) * 50,
        vy: -30 - Math.random() * 30, g: 120, life: 0.4 + Math.random() * 0.3, size: 1, color: Math.random() < 0.5 ? VIC.white : VIC.cyan });
    } else if (hit.pine) SFX.playExplosion(); else SFX.playBreak();
    if (hit.pine) {
      exploded.add(hit.i + ',' + hit.j);
      spawnExplosion(hit.x, hit.y - 4);
    }
    closeSession();
    // Long enough to watch the pieces land.
    const id = runId;
    setTimeout(() => { if (runId === id) showOverlay(false); }, hit.pine ? 1400 : 900);
  }

  // On fire: whatever was hit goes up like a pineapple, for points.
  // A pineapple just explodes; a tree or a fence explodes in flames.
  function burn(hit) {
    if (hit.animal) {   // no exploding animals: it yelps and bolts
      dogLeaves(hit.a);
      if (hit.kind === 'bear' || hit.kind === 'leopard') SFX.playGrowl(); else SFX.playBark();
      return;
    }
    // A tent goes up like a fence (its people are all outside).
    const kind = hit.fence || hit.tent ? 'fence' : hit.pine ? 'pine' : 'tree';
    const key = hit.tent ? 'tent' + hit.n : hit.net ? 'e' + hit.k : hit.fence ? `f${hit.k},${hit.side}` : hit.i + ',' + hit.j;
    exploded.add(key);
    const fire = fireColors(runGod);
    if (kind === 'tree' && !hit.rock && !hit.pen && !hit.ice) scorched.set(key, { at: performance.now(), god: runGod, hit: true });
    if (hit.tent) scorched.set(key, { at: performance.now(), god: runGod });
    else if (hit.net) {   // torn open where you went through
      const y = Math.round(hit.y);
      scorched.set(key, { at: performance.now(), god: runGod, gapY0: y - 5, gapY1: y + 5 });
    } else if (kind === 'fence') {
      const x = Math.round(hit.x);
      scorched.set(key, { at: performance.now(), god: runGod, gap0: x - 3, gap1: x + 3 });
    }
    burned[kind]++;
    SFX.playExplosion();
    spawnExplosion(hit.x, hit.y - 4, hit.pen || hit.ice ? PEN_PIECES : hit.rock ? ROCK_PIECES : hit.tent ? [...fire, ...fire, VIC.orange, VIC.yellow] : kind === 'tree' ? [...fire, ...fire, ...TREE_PIECES]
      : kind === 'fence' ? [...fire, ...fire, ...FENCE_PIECES] : PIECE_COLORS);
    // A pineapple smashed on fire takes back a miss, or banks one: Endless
    // can go above 4 LEFT, Single below 0 misses, which takes time off.
    const forgive = kind === 'pine';
    if (forgive) { missed--; forgiven++; SFX.playForgiven(); }
    pop(`${hit.ice ? 'ICE' : hit.pen ? 'PENITENTE' : hit.rock ? 'ROCK' : hit.tent ? 'TENT' : hit.net ? 'NET' : { pine: 'PINEAPPLE', tree: 'TREE', fence: 'FENCE' }[kind]} +${BURN_POINTS[kind]}${forgive ? '  MISS FORGIVEN' : ''}`);
    paintHud();
  }

  // Endless, the last miss: no crash, the skier just coasts to a halt.
  let ranOut = false;
  function outOfMisses() {
    state = 'crashed';
    ranOut = true;
    runEnd = performance.now();
    SFX.stopSwoosh();
    closeSession();
    const id = runId;
    setTimeout(() => { if (runId === id) showOverlay(false); }, 1400);
  }

  function finish() {
    // Poles not yet resolved can only be ones skipped right before the line.
    while (nextPole < course.poles.length) resolvePole(false);
    state = 'finished';
    mode = 'down';
    SFX.stopSwoosh();
    SFX.playFanfare();
    flash(`FINISH +${FINISH_POINTS}`);
    runEnd = performance.now();
    closeSession();
    // Time to glide to a stop past the line before the bonus counts up.
    const id = runId;
    setTimeout(() => { if (runId === id) startTally(); }, 1100);
  }

  // ------------------------------------------------------------- the tally
  // At the finish the time bonus drains into the score, in big digits on
  // the slope: a tick per step rising in pitch, the bigger the bonus the
  // longer it runs.
  // A ding, then the stars one by one; three of them get a jingle and
  // sparkles. Space skips to the card.
  let tally = null;
  let shownBonus = 0;          // how much of the bonus the HUD has taken in
  const TALLY_STAR_GAP = 0.45; // seconds between stars

  function startTally() {
    if (state !== 'finished' || tally) return;
    const bonus = timeBonus();
    tally = {
      bonus, shown: 0, stars: stars(), starsShown: 0,
      t: 0, lastTick: -1, dinged: false,
      count: bonus ? 0.6 + 1.6 * Math.min(1, bonus / 1500) : 0.4,
    };
    bonusTimeEl.textContent = `TIME ${fmt(bonusCs())}`;
    showTransfer(tally, 0);
    bonusEl.hidden = false;
  }

  function updateTally(dt) {
    const k = tally;
    k.t += dt;
    if (k.t < k.count) {
      const f = k.t / k.count;
      k.shown = Math.round(k.bonus * (1 - (1 - f) * (1 - f)));   // eases in
      const step = Math.floor(k.t / 0.045);
      if (k.bonus && step !== k.lastTick) { k.lastTick = step; SFX.playTick(f); }
    } else if (!k.dinged) {
      k.shown = k.bonus;
      k.dinged = true;
      if (k.bonus) SFX.playDing(); else SFX.playNoBonus();
    } else {
      const due = Math.min(k.stars, Math.floor((k.t - k.count) / TALLY_STAR_GAP));
      while (k.starsShown < due) {
        k.starsShown++;
        SFX.playStar(k.starsShown);
        if (k.starsShown === 3) {
          SFX.playJingle();
          spawnSparkles(camX + VW / 2, cameraTop() + STAR_ROW);
        }
      }
      // The card once the last star has had its moment.
      const hold = k.stars === 3 ? 2.2 : 1.2;
      if (k.t >= k.count + k.stars * TALLY_STAR_GAP + hold) endTally();
    }
    shownBonus = k.shown;
    showTransfer(k, k.shown);
  }

  // The bonus drains into the score: what's left of one, the total so far.
  // Takes the tally rather than reading it: the last update ends it.
  function showTransfer(k, moved) {
    bonusScoreEl.textContent = `SCORE ${earned() + moved}`;
    bonusPointsEl.textContent = `BONUS +${k.bonus - moved}`;
  }

  function endTally() {
    if (!tally) return;
    shownBonus = tally.bonus;
    tally = null;
    bonusEl.hidden = true;
    showOverlay(true);
  }

  // Past the line: coast to a stop, still on screen.
  function glide(dt) {
    const k = Math.exp(-6 * dt);
    speed *= k; vx *= k;
    skierY = Math.min(skierY + speed * dt, course.finishY + (course.arena ? course.arena.ry * 0.5 : 12));
    panToArena(dt);
    skierX = Math.max(2, Math.min(W - 3, skierX + vx * dt));
  }

  // The camera follows the skier until the finish line is FINISH_ROW down
  // the screen, then holds still and lets the skier run down to it.
  function cameraTop() {
    if (!course) return -SKIER_Y;
    return Math.floor(Math.min(skierY - SKIER_Y, course.finishY - FINISH_ROW) + pan);
  }
  // Past the line at an arena, the view slides down to take in the crowd.
  let pan = 0;
  function panToArena(dt) {
    if (!course.arena || state !== 'finished') return;
    const target = Math.max(0, course.arena.ry + 50 - H + FINISH_ROW);
    pan += (target - pan) * Math.min(1, dt * 1.8);
  }

  // The narrow window's left edge, in world x: centred on the piste a
  // little below the skier, where the eye is, but never letting the skier
  // near the side, and never past the mountain's edges.
  const SIDE_ROOM = 16;
  function cameraLeft(camY) {
    if (!NARROW) return -MARGIN;
    const centerAt = course ? course.centerAt : titleCenter;
    const ahead = camY + SKIER_Y;
    let x = (centerAt(ahead) + centerAt(ahead + 80)) / 2 - VW / 2;
    if (state !== 'title') x = Math.max(skierX + SIDE_ROOM - VW, Math.min(skierX - SIDE_ROOM, x));
    return Math.round(Math.max(0, Math.min(W - VW, x)));
  }

  function resolvePole(through, clipped) {
    const p = course.poles[nextPole];
    p.result = through ? 'pass' : 'miss';
    if (through) {
      passed++;
      const said = [];
      if (p.red) { reds++; said.push(`RED +${POLE_POINTS + RED_POINTS}`); }
      if (clipped) {
        clips++; streak++;
        const pts = CLIP_POINTS * Math.min(streak, COMBO_CAP);
        clipPoints += pts;
        said.unshift(streak === 1 ? `CLIP +${pts}` : `${Math.min(streak, COMBO_CAP)}x COMBO !!! +${pts}`);
        SFX.playCoin(Math.min(streak, COMBO_CAP));
        if (streak === FIRE_AT) {
          if (!runGod) { SFX.playIgnite(); SFX.playPowerUp(); }
          const id = runId;
          setTimeout(() => { if (runId === id && streak >= FIRE_AT) pop('YOU ARE ON FIRE !!!'); }, 1000);
        }
      } else endStreak();
      if (said.length) pop(said.join('  '));
    } else {
      endStreak();
      missed++;
      // Brushed on the wrong side is a fork: still a miss, but it says so,
      // and clacks, since on screen it looks a lot like a clip.
      if (clipped) SFX.playClack();
      const what = clipped ? 'FORK  MISS' : 'MISS';
      // The time bonus is lost once, on the miss that loses it. Endless
      // has no clock for a miss to add to.
      pop(course.endless ? what
        : missed === MISS_LIMIT + 1 ? `${what}  NO TIME BONUS` : `${what} +${fmt(MISS_CS)}`);
      if (course.endless && missed === ENDLESS_MISSES - 1) SFX.playBlips();
      if (course.endless && missed >= ENDLESS_MISSES) outOfMisses();
    }
    nextPole++;
    paintHud();
  }

  function endStreak() {
    if (streak >= FIRE_AT && !runGod) SFX.playDouse();
    if (streak) streaks.push(streak);
    streak = 0;
  }

  // ----------------------------------------------------------------- input
  const LEFT = new Set(['ArrowLeft', 'a', 'A', '4']);
  const RIGHT = new Set(['ArrowRight', 'd', 'D', 'l', 'L', '6']);
  const STRAIGHT = new Set(['ArrowDown', 's', 'S', '2']);
  const GO = new Set([' ', 'Enter']);
  const SHIFTS = { ShiftLeft: 'left', ShiftRight: 'right' };

  function press(id, dir) {
    held = held.filter(h => h.id !== id);
    held.push({ id, dir });
    tapDir = dir; tapLeft = MIN_TURN;
  }
  function release(id) { held = held.filter(h => h.id !== id); }
  function straighten() { held = []; tapLeft = 0; }

  // No zooming mid-run. iPhone browsers (Safari and Chrome alike, both
  // WebKit) ignore the viewport's user-scalable=no, and two thumbs on the
  // arrows drifting apart reads as a pinch. Cancelling WebKit's own gesture
  // events and any two-finger touch move stops it; taps and the arrows
  // work through pointer events, which this leaves alone.
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(type, (e) => e.preventDefault());
  }
  document.addEventListener('touchmove', (e) => {
    if (e.touches.length > 1) e.preventDefault();
  }, { passive: false });
  document.addEventListener('dblclick', (e) => e.preventDefault());

  // Any first key, tap or click lets the page make sound.
  window.addEventListener('pointerdown', SFX.unlock);

  // The box art first, as in snake-bit. PLAY is the first click, so it
  // also lets the page make sound; nothing underneath answers until then.
  const splashEl = document.getElementById('splash');
  let splashUp = !!splashEl;
  function dismissSplash() {
    if (!splashUp) return;
    splashUp = false;
    SFX.unlock();
    splashEl.classList.add('fade-out');
    splashEl.addEventListener('transitionend', () => splashEl.remove(), { once: true });
    placeHudButtons();
  }
  if (splashEl) document.getElementById('splash-play').addEventListener('click', dismissSplash);

  window.addEventListener('keydown', (e) => {
    SFX.unlock();
    if (splashUp) {
      if (GO.has(e.key)) { e.preventDefault(); dismissSplash(); }
      return;
    }
    if (document.activeElement === initialsInputEl) return;
    // The Championship's screens: left and right choose, Space goes on,
    // Escape leaves for the menu, R starts the Championship over.
    if (champUp()) {
      const dir = SHIFTS[e.code] || (LEFT.has(e.key) ? 'left' : RIGHT.has(e.key) ? 'right' : null);
      if (GO.has(e.key)) { e.preventDefault(); champGo(); }
      else if (dir) { e.preventDefault(); if (!e.repeat) champStep(dir === 'left' ? -1 : 1); }
      else if (e.key === 'Escape') toTitle();
      else if (e.key === 'r' || e.key === 'R') restart();
      else if (e.key === 'm' || e.key === 'M') flash(SFX.toggleMute() ? 'SOUND OFF' : 'SOUND ON');
      return;
    }
    // A Single mountain's card: Space (or R) skis it, Escape goes back.
    if (introUp()) {
      if (GO.has(e.key) || e.key === 'r' || e.key === 'R') { e.preventDefault(); introGo(); }
      else if (e.key === 'Escape') toTitle();
      else if (e.key === 'm' || e.key === 'M') flash(SFX.toggleMute() ? 'SOUND OFF' : 'SOUND ON');
      return;
    }
    if ((state === 'title' || state === 'crashed' || state === 'finished') && !boardView) konami(e.key);
    // With the board up, Space or Escape closes it and R restarts.
    if (boardView) {
      if (GO.has(e.key) || e.key === 'Escape') { e.preventDefault(); closeBoard(); }
      else if (e.key === 'r' || e.key === 'R') { e.preventDefault(); closeBoard(); restart(); }
      else if (e.key === 'm' || e.key === 'M') flash(SFX.toggleMute() ? 'SOUND OFF' : 'SOUND ON');
      return;
    }
    // Up and down (or W and S) pick Single's course. The Konami code's
    // W W S S ends where it began, like its A D A D on the modes.
    const vKey = e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W' ? -1 : e.key === 'ArrowDown' || e.key === 's' || e.key === 'S' ? 1 : 0;
    if (state === 'title' && !boardView && chosenMode() === 'single' && vKey) {
      e.preventDefault();
      if (!e.repeat) chooseCourse(singleIndex + vKey);
      return;
    }
    const titleDir = SHIFTS[e.code] || (LEFT.has(e.key) ? 'left' : RIGHT.has(e.key) ? 'right' : null);
    if ((state === 'title' || cardUp()) && titleDir) {
      e.preventDefault();
      const step = titleDir === 'left' ? -1 : 1;
      if (!e.repeat) state === 'title' ? chooseMode(modeIndex + step) : pickCard(cardPick + step);
      return;
    }
    const id = 'k' + e.key.toLowerCase();
    // The two Shifts turn too, one per hand. Same key, so tell them apart
    // by where it sits.
    if (SHIFTS[e.code]) {
      e.preventDefault();
      if (!e.repeat) press('k' + e.code, SHIFTS[e.code]);
    } else if (LEFT.has(e.key) || RIGHT.has(e.key)) {
      e.preventDefault();
      if (!e.repeat) press(id, LEFT.has(e.key) ? 'left' : 'right');
    } else if (STRAIGHT.has(e.key)) { straighten(); e.preventDefault(); }
    else if (e.key === 'm' || e.key === 'M') flash(SFX.toggleMute() ? 'SOUND OFF' : 'SOUND ON');
    else if (e.key === 'r' || e.key === 'R') { e.preventDefault(); restart(); }
    else if (GO.has(e.key)) { e.preventDefault(); spaceAction(); }
    else if (e.key === 'Escape') backOut();
  });

  // Up up down down left right left right, any time but mid-run: god mode
  // for every run from the next one, until it's entered again.
  const KONAMI = 'uuddlrlr';
  const KONAMI_DIRS = { ArrowUp: 'u', w: 'u', W: 'u', ArrowDown: 'd', s: 'd', S: 'd',
    ArrowLeft: 'l', a: 'l', A: 'l', ArrowRight: 'r', d: 'r', D: 'r' };
  let konamiSoFar = '';
  function konami(key) {
    konamiSoFar = (konamiSoFar + (KONAMI_DIRS[key] || '-')).slice(-KONAMI.length);
    if (konamiSoFar !== KONAMI) return;
    konamiSoFar = '';
    godMode = !godMode;
    // The title's course is a fresh one, with or without a session to rank
    // it; after a run, going back to the title prepares the next one anyway.
    if (state === 'title') prepareRun();
    flash(godMode ? 'GOD MODE ON' : 'GOD MODE OFF');
    fetchLeaderboard();   // so the next run knows what it must beat
  }

  // The title's three modes. Left and right move the highlight, which wraps
  // so the Konami code's left-right-left-right ends where it began.
  const MODE_TEXT = {
    single: 'TEST YOUR SLALOM SKILLS:<br>25 POLES, ONE MOUNTAIN, NO SECOND CHANCES.',
    championship: '10 OUT OF 14 LEGENDARY MOUNTAINS, ONE CHAMPION.<br>CAN YOU CONQUER THE NORTH FACE OF EVEREST?',
    endless: 'NO FINISH LINE. HOW FAR CAN YOU GO?<br>A CRASH OR 4 MISSES AND IT\'S OVER.',
  };
  const modeBtns = [...document.querySelectorAll('.mode-btn')];
  const modeTextEl = document.getElementById('mode-text');
  let modeIndex = 0;
  function chooseMode(i) {
    modeIndex = (i + modeBtns.length) % modeBtns.length;
    modeBtns.forEach((b, k) => b.classList.toggle('chosen', k === modeIndex));
    modeTextEl.innerHTML = MODE_TEXT[modeBtns[modeIndex].dataset.mode];
    if (chosenMode() === 'single') { chooseCourse(singleIndex); return; }
    paintCourseList();
    paintHud();
    if (!leaderboardCache[currentBoard()]) fetchLeaderboard();
  }
  const chosenMode = () => modeBtns[modeIndex].dataset.mode;

  // Single's course: Random (a fresh slope every run, as ever) or one of
  // the Championship mountains, lowest to highest. Remembered between visits.
  const courseListEl = document.getElementById('course-list');
  const SINGLE_COURSES = ['random'];   // the mountains join once they're defined
  let singleIndex = 0;
  const singleCourse = () => SINGLE_COURSES[singleIndex];
  const classicPick = () => (chosenMode() === 'single' && singleCourse() !== 'random' ? singleCourse() : null);
  function paintCourseList() {
    courseListEl.hidden = chosenMode() !== 'single';
    if (courseListEl.hidden) return;
    if (!courseListEl.children.length) {
      SINGLE_COURSES.forEach((id, k) => {
        const li = document.createElement('li'), m = id === 'random' ? null : mountain(id);
        const flag = document.createElement('span'); flag.className = 'flag-cell';
        flag.append(...(m ? FLAGS_OF[id] : ['random']).map(flagCanvas));   // both, where a mountain has two
        const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = m ? m.short || m.name.split(/ \(| "/)[0] : 'RANDOM';
        const alt = document.createElement('span'); alt.className = 'alt'; alt.textContent = m ? m.height.replace('~', '') : '';
        li.append(flag, nm, alt);
        li.addEventListener('click', (e) => {
          e.stopPropagation();
          if (state !== 'title') return;
          if (k === singleIndex) startChosen(); else chooseCourse(k);
        });
        courseListEl.appendChild(li);
      });
    }
    [...courseListEl.children].forEach((li, k) => li.classList.toggle('chosen', k === singleIndex));
    const li = courseListEl.children[singleIndex];
    if (li && li.scrollIntoView) li.scrollIntoView({ block: 'center' });
  }
  function chooseCourse(k) {
    singleIndex = (k + SINGLE_COURSES.length) % SINGLE_COURSES.length;
    try { localStorage.setItem('slalom_single_course', singleCourse()); } catch (_) {}
    const m = classicPick() && mountain(classicPick());
    modeTextEl.innerHTML = m ? `${m.name.split(/ \(| "/)[0]} &middot; ${m.country} &middot; ${m.height}<br>THE CHAMPIONSHIP COURSE` : MODE_TEXT.single;
    paintCourseList();
    paintHud();
    if (!leaderboardCache[currentBoard()]) fetchLeaderboard();
  }
  function startChosen() {
    if (singleIntro) introGo();
    else if (chosenMode() === 'championship') startChampionship();
    else if (classicPick()) showSingleIntro(mountain(classicPick()));
    else startRun();
  }
  // The highlighted one starts; any other is highlighted first, so its
  // explanation can be read.
  modeBtns.forEach((btn, i) => btn.addEventListener('click', () => {
    btn.blur();
    if (state !== 'title') return;
    if (i === modeIndex) startChosen();
    else chooseMode(i);
  }));

  // Space, or a tap on the screen: start, pause and resume, skip the tally,
  // and after a run, go again.
  function spaceAction() {
    if (state === 'title') startChosen();
    else if (state === 'running' || state === 'paused') togglePause();
    else if (tally) endTally();
    else if (cardUp()) cardBtns[cardPick].click();
    else if (cardClosed && (state === 'crashed' || state === 'finished')) restart();
  }
  window.addEventListener('keyup', (e) => release(SHIFTS[e.code] ? 'k' + e.code : 'k' + e.key.toLowerCase()));
  // A key let go while the window is unfocused never sends keyup.
  window.addEventListener('blur', straighten);

  // Touch: a tap on the screen is Space. Steering is the two arrow
  // buttons in the bottom corners, held like the keys: the pointer is
  // captured, so a thumb sliding off the button keeps turning until lifted.
  // A tap this close to an arrow is a thumb that missed it, not a pause.
  const ARROW_SAFE = 40;
  const arrowBtns = [...document.querySelectorAll('.arrow-btn')];
  const nearArrow = (x, y) => arrowBtns.some((btn) => {
    const r = btn.getBoundingClientRect();
    return r.width > 0 && x > r.left - ARROW_SAFE && x < r.right + ARROW_SAFE
      && y > r.top - ARROW_SAFE && y < r.bottom + ARROW_SAFE;
  });
  // A click is Space. A tap is too, except on the title, where you tap a
  // mode, and near the arrows, which are for steering.
  canvas.addEventListener('pointerdown', (e) => {
    SFX.unlock();
    if (e.pointerType === 'mouse') { if (e.button === 0) spaceAction(); return; }
    if (nearArrow(e.clientX, e.clientY) || state === 'title') return;
    spaceAction();
  });
  arrowBtns.forEach((btn) => {
    const dir = btn.dataset.dir;
    const id = 'b' + dir;
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      SFX.unlock();
      // On the title they browse the modes instead.
      if (state === 'title' && !boardView) { chooseMode(modeIndex + (dir === 'left' ? -1 : 1)); return; }
      try { btn.setPointerCapture(e.pointerId); } catch (_) {}
      press(id, dir);
    });
    const up = () => release(id);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('lostpointercapture', up);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  });

  // --------------------------------------------------------------- physics
  function step(dt) {
    tapLeft = Math.max(0, tapLeft - dt);
    const was = heading;
    heading = held.length ? held[held.length - 1].dir : tapLeft > 0 ? tapDir : 'down';
    // Every change of direction snaps; straightening up a little softer,
    // and the faster you're going the sharper the snap.
    if (heading !== was) {
      SFX.playDash((heading === 'down' ? 0.5 : 1) * Math.min(1.4, 0.3 + 0.7 * speed / DOWN_SPEED));
    }
    const steering = heading !== 'down';
    mode = heading;

    // The couloir's walls: no fire gets through rock. Only a god does.
    if (course.wall(skierX, skierY) && !runGod) { crash({ wall: true }); return; }
    const hit = hitTree(skierX, skierY) || hitFence(skierX, skierY) || hitEdgeNet(skierX, skierY) || hitTent(skierX, skierY) || hitAnimal(skierX, skierY);
    // A crevasse can't be burned through; only a god walks over it.
    if (hit && hit.crevasse && runGod) { /* across */ }
    else if (hit && onFire() && !hit.crevasse) burn(hit);
    else if (hit) { crash(hit); return; }

    // Holding a straight line builds speed: quickly at first, then more
    // the longer you hold it. Any steering cancels it.
    straightFor = steering ? 0 : straightFor + dt;
    const tuck = steering
      ? CARVE_FACTOR
      : 1 + TUCK_BONUS * Math.min(1, straightFor / TUCK_RAMP)
          + TUCK_EXTRA * Math.max(0, Math.min(1, (straightFor - TUCK_RAMP) / TUCK_EXTRA_RAMP));

    // Fresh snow: drag grows with depth, the same depth the speckle shows.
    const depth = snowDepth(skierX, course.centerAt(skierY), skierY);
    // Bare scree grabs the skis: a hard slowdown, a scrape and sparks.
    const onScree = course.screeAt(skierX, skierY);
    if (onScree) scrape(dt);
    const target = DOWN_SPEED * course.slopeAt(skierY) * tuck * (1 - DEEP_SNOW_DRAG * depth) * (onScree ? SCREE_DRAG : 1);
    const rate = target > speed ? ACCEL_RATE : DECEL_RATE;
    speed += (target - speed) * Math.min(1, dt * rate);

    const targetVx = heading === 'left' ? -LATERAL : heading === 'right' ? LATERAL : 0;
    vx += (targetVx - vx) * Math.min(1, dt * 10);

    skierY += speed * dt;
    skierX = Math.max(2, Math.min(W - 3, skierX + vx * dt));
    if (course.shape.wind) blowWind(dt);

    // A pole is cleared when the skier crosses its row with both skis on
    // the flag side. See SKIS and CLIP_REACH.
    if (course.endless) course.extend(skierY);
    while (nextPole < course.poles.length && course.poles[nextPole].y <= skierY) {
      const p = course.poles[nextPole];
      const dx = (skierX - p.x) * p.pass;
      const through = dx > SKIS;
      const brushed = dx >= -CLIP_REACH && dx <= CLIP_REACH;
      if (brushed) p.fallen = skierX < p.x ? 1 : -1;
      resolvePole(through, brushed);
      // Clipped on fire, it burns where it fell, then goes to ash.
      if (through && brushed && onFire()) p.burning = { at: performance.now(), god: runGod };
    }

    if (onFire()) scorchPassed();
    if (course.couloir && moveSluff(dt)) { crash({ sluff: true }); return; }
    if (course.shape.avalanche && moveAvalanche(dt)) { crash({ avalanche: true }); return; }
    if (snowballs.length) { const b = moveSnowballs(dt); if (b) knockedBySnowball(b); }
    if (course.shape.serac) {
      // A chunk knocks you back, it doesn't end the run: it shatters and
      // you lose most of your speed. On fire you smash it for points.
      const chunk = moveIcefall(dt);
      if (chunk && onFire()) smashChunk(chunk);
      else if (chunk) knockedByIce(chunk);
    }
    if (crossed < course.borders.length && skierY >= course.borders[crossed]) { crossed++; flash(course.shape.welcome, 1800); }
    if (skierY >= course.finishY) finish();
  }

  // Katabatic wind: calm for a while, then a second of warning (thin
  // streaks and a hiss from one side), then a gust that pushes you that
  // way for two or three seconds. Never a push without the warning.
  const WIND_PUSH = 28, WIND_CALM = [3, 6], WIND_WARN = 1, WIND_GUST = [2, 3];
  let wind = null, gustLines = [];
  function blowWind(dt) {
    if (!wind) wind = { phase: 'calm', t: between(WIND_CALM), dir: 1, len: 1 };
    wind.t -= dt;
    if (wind.t <= 0) {
      if (wind.phase === 'calm') { wind.phase = 'warn'; wind.t = WIND_WARN; wind.dir = Math.random() < 0.5 ? -1 : 1; }
      else if (wind.phase === 'warn') { wind.phase = 'gust'; wind.len = wind.t = between(WIND_GUST); }
      else { wind.phase = 'calm'; wind.t = between(WIND_CALM); }
    }
    if (wind.phase === 'gust') skierX = Math.max(2, Math.min(W - 3, skierX + wind.dir * WIND_PUSH * gustEnvelope() * dt));
  }
  const gustEnvelope = () => Math.max(0, Math.min(1, (wind.len - wind.t) / 0.3, wind.t / 0.4));
  // How hard it's blowing, 0..1, for the sound and the streaks.
  const windLevel = () => !wind || state !== 'running' ? 0
    : wind.phase === 'warn' ? 0.1 + 0.25 * (1 - wind.t / WIND_WARN)
    : wind.phase === 'gust' ? 0.35 + 0.65 * gustEnvelope() : 0;
  // The streaks: thin dashes of blown snow racing across the screen.
  function updateStreaks(dt) {
    const level = windLevel();
    if (level > 0 && Math.random() < level * 70 * dt) {
      const dir = wind.dir;
      gustLines.push({ x: dir > 0 ? -12 : VW + 12, y: Math.random() * H, len: 3 + Math.floor(Math.random() * (4 + 8 * level)),
        v: dir * (150 + Math.random() * 90), ink: Math.random() < 0.5 ? VIC.lightBlue : VIC.cyan, drift: level > 0.6 && Math.random() < 0.4 });
    }
    for (const k of gustLines) k.x += k.v * dt;
    gustLines = gustLines.filter(k => k.x > -20 && k.x < VW + 20);
  }
  function drawStreaks() {
    for (const k of gustLines) {
      const dir = Math.sign(k.v);
      for (let i = 0; i < k.len; i++) if (!k.drift || i % 2 === 0) put(Math.round(camX + k.x - dir * i), Math.round(k.y), k.ink);
    }
  }

  // Grinding over scree: a scrape every so often, sparks off the skis.
  const SCREE_DRAG = 0.5;
  let scrapeIn = 0;
  function scrape(dt) {
    scrapeIn -= dt;
    if (scrapeIn <= 0) { scrapeIn = 0.09; SFX.playScrape(Math.min(1, speed / DOWN_SPEED)); }
    if (Math.random() < 0.6) {
      particles.push({ x: skierX + (Math.random() - 0.5) * 4, y: skierY + 3, vx: (Math.random() - 0.5) * 40, vy: -20 - Math.random() * 30,
        g: 200, life: 0.15 + Math.random() * 0.15, size: 1, color: Math.random() < 0.5 ? VIC.yellow : VIC.white });
    }
  }

  // Sluff: ski a steep gully and the snow you knock loose pours down
  // after you. It sets off when you drop in, a little way behind, and runs
  // about as fast as a skier who keeps turning, faster towards the bottom;
  // slow down too much and it knocks you over. Out of the gully it fans
  // out and stops. Returns true if it caught you.
  // It never falls further behind than SLUFF_HOLD rows: get ahead and it
  // speeds up to stay on your tail, in view.
  const SLUFF_BEHIND = 30, SLUFF_V0 = 86, SLUFF_V1 = 99, SLUFF_STOP = 160, SLUFF_HOLD = 26;
  function moveSluff(dt) {
    const { c0, c1 } = course.couloir;
    if (!sluff) {
      if (skierY < c0) return false;
      sluff = { y: c0 - SLUFF_BEHIND, v: SLUFF_V0 };
    }
    if (sluff.v <= 0) return false;
    if (sluff.y < c1) {
      const base = SLUFF_V0 + (SLUFF_V1 - SLUFF_V0) * Math.max(0, (sluff.y - c0) / (c1 - c0));
      sluff.v = Math.max(base, Math.min(260, speed + 3 * (skierY - sluff.y - SLUFF_HOLD)));
    } else sluff.v = Math.max(0, sluff.v - SLUFF_STOP * dt);
    sluff.y += sluff.v * dt;
    return !runGod && sluff.y >= skierY - 2;
  }

  // The avalanche: as you pass pole `from` the mountain starts to rumble;
  // a second later a wall of snow comes over the top of the screen, right
  // across the slope, and holds on your tail like the sluff. Keep your
  // speed. At pole `to` the wall stops, everything behind it buried, and
  // breaks up into big snowballs that roll on, some faster than you, and
  // come to rest as lumps: a patchy stretch on to the finish. A snowball
  // or a lump knocks you back; the wall itself swallows you.
  const SLIDE_RUMBLE = 1.1, SLIDE_HOLD = 34, SLIDE_V = 64, SLIDE_STOP = 90;
  const SNOWBALLS = 24;
  // While it chases you it hurls snowballs, big and small, over your head:
  // each lands ahead of you (its shadow racing ahead shows where), rolls a
  // little and sits there as a lump. Hit one and it slows you, a big one a
  // lot, and then the wall is on you.
  const THROW_EVERY = [0.7, 1.3], THROW_TIME = 0.9, THROW_ARC = 28, THROW_AHEAD = [28, 75];
  const KNOCK_BIG = 0.35, KNOCK_SMALL = 0.65;
  function moveAvalanche(dt) {
    const av = course.shape.avalanche, poles = course.poles;
    if (!slide) {
      if (skierY < poles[av.from].y) return false;
      slide = { rumble: SLIDE_RUMBLE, y: null, v: 0, end: poles[Math.min(av.to, poles.length - 1)].y, hold: av.hold || SLIDE_HOLD, throwIn: 1 };
    }
    if (slide.rumble > 0) {
      slide.rumble -= dt;
      if (slide.rumble <= 0) { slide.y = cameraTop() - 6; slide.v = speed; }
      return false;
    }
    if (slide.v <= 0) return false;
    if (slide.y < slide.end) {
      slide.v = Math.max(av.minV || SLIDE_V, Math.min(280, speed + 3 * (skierY - slide.y - slide.hold)));
      if (av.throws && (slide.throwIn -= dt) <= 0) { slide.throwIn = between(THROW_EVERY); throwSnowball(); }
    } else if (av.breakUp) { breakUp(); return false; }
    else slide.v = Math.max(0, slide.v - SLIDE_STOP * dt);
    slide.y += slide.v * dt;
    return !runGod && slide.y >= skierY - 2;
  }
  function breakUp() {
    slide.v = 0;
    const c = course, finishY = c.finishY;
    for (let k = 0; k < SNOWBALLS; k++) {
      // A third or so on the piste, the rest anywhere across the slope.
      const onPiste = Math.random() < 0.4, cy = slide.y;
      const x = onPiste ? c.centerAt(cy) + (Math.random() * 2 - 1) * c.widthAt(cy) : -MARGIN + Math.random() * (W + 2 * MARGIN);
      const fast = k % 2 === 0;   // these overtake you and settle ahead
      const y = slide.y - Math.random() * 5;
      const lo = fast ? Math.min(skierY + 25, finishY - 14) : y + 8, hi = fast ? finishY - 8 : Math.min(y + 50, finishY - 8);
      const r = 3 + Math.floor(Math.random() * 3);
      snowballs.push({ x, y, r, big: r >= 4, v0: speed * (fast ? 1.15 + Math.random() * 0.3 : 0.55 + Math.random() * 0.35),
        v: 1, stopAt: lo + Math.random() * Math.max(0, hi - lo), dx: (Math.random() - 0.5) * 12, top: y, roll: Math.random() * 4 });
    }
    SFX.playBreak();
  }
  function throwSnowball() {
    const c = course, big = Math.random() < 0.4;
    // Lands where you'll be in a moment, give or take, mostly on the piste.
    const y1 = Math.min(skierY + speed * THROW_TIME + between(THROW_AHEAD), slide.end + 40);
    const x1 = Math.random() < 0.75 ? c.centerAt(y1) + (Math.random() * 2 - 1) * c.widthAt(y1) * 0.9
      : skierX + (Math.random() * 2 - 1) * 50;
    const x0 = x1 + (Math.random() * 2 - 1) * 30;
    snowballs.push({ x: x0, y: slide.y, r: big ? 4 + Math.floor(Math.random() * 2) : 2 + Math.floor(Math.random() * 2), big,
      air: { t: 0, x0, y0: slide.y, x1, y1 }, v0: 12 + Math.random() * 14, v: 0, stopAt: y1 + 3 + Math.random() * 8,
      dx: (Math.random() - 0.5) * 8, top: y1, roll: Math.random() * 4 });
  }
  // Rolls them on; returns the one you ran into, if any.
  function moveSnowballs(dt) {
    for (const b of snowballs) {
      if (b.air) {   // in flight: along a line, the height on top
        const a = b.air;
        a.t = Math.min(1, a.t + dt / THROW_TIME);
        b.x = a.x0 + (a.x1 - a.x0) * a.t; b.y = a.y0 + (a.y1 - a.y0) * a.t;
        if (a.t >= 1) {   // down with a thump and a puff
          b.air = null; b.v = b.v0;
          for (let k = 0; k < 6; k++) particles.push({ x: b.x + (Math.random() - 0.5) * b.r * 2, y: b.y, vx: (Math.random() - 0.5) * 30,
            vy: -10 - Math.random() * 20, g: 120, life: 0.25 + Math.random() * 0.2, size: 1, color: VIC.white });
        }
        continue;
      }
      if (b.v <= 0) continue;
      const left = b.stopAt - b.y;
      b.v = Math.min(b.v0, Math.max(6, left * 2.2));
      b.y += b.v * dt;
      b.x += b.dx * dt * (b.v / b.v0);
      b.roll += b.v * dt / b.r;
      if (left < 0.5) b.v = 0;   // a lump now, for good
    }
    if (snowballs.length > 60) snowballs = snowballs.filter(b => b.air || b.y > cameraTop() - 80);   // long buried
    return snowballs.find(b => !b.air && Math.abs(b.x - skierX) <= b.r + 1 && skierY >= b.y - b.r - 1 && skierY <= b.y + b.r + 1) || null;
  }
  function knockedBySnowball(b) {
    snowballs.splice(snowballs.indexOf(b), 1);
    const big = b.big ?? b.r >= 4;
    speed *= big ? KNOCK_BIG : KNOCK_SMALL;
    vx *= 0.3;
    SFX.playBreak();
    for (let k = 0; k < 12; k++) particles.push({ x: b.x + (Math.random() - 0.5) * b.r * 2, y: b.y, vx: (Math.random() - 0.5) * 50,
      vy: -20 - Math.random() * 30, g: 120, life: 0.35 + Math.random() * 0.3, size: 1, color: Math.random() < 0.6 ? VIC.white : VIC.lightBlue });
    pop('SNOWBALL!');
  }
  // The Bottleneck: along one stretch a serac hangs over one side of the
  // piste, and every second or so a chunk breaks off (with a crack) a
  // little way ahead of you and slides across. Time your way through.
  const ICE_EVERY = [0.8, 1.5], ICE_SPEED = [30, 42];
  const CHUNK = ['.VV.', 'VCWV', 'VCCV', '.BB.'];
  function seracRows() {
    const sr = course.shape.serac;
    return [sr.from * course.finishY, sr.to * course.finishY];
  }
  // Returns the chunk that hit you, if one did.
  function moveIcefall(dt) {
    const sr = course.shape.serac, [y0, y1] = seracRows();
    iceIn -= dt;
    if (iceIn <= 0 && skierY > y0 - 120 && skierY < y1) {
      iceIn = between(ICE_EVERY);
      const y = Math.round(skierY + 70 + Math.random() * 70);
      if (y > y0 && y < y1) {
        const c = course.centerAt(y);
        icefall.push({ x: c + sr.side * (course.widthAt(y) + 6), y, v: -sr.side * between(ICE_SPEED) });
        SFX.playCrack();
      }
    }
    for (const k of icefall) k.x += k.v * dt;
    icefall = icefall.filter(k => Math.abs(k.x - course.centerAt(k.y)) < course.widthAt(k.y) + 30);
    return icefall.find(k => Math.abs(k.x - skierX) <= 2.5 && skierY >= k.y - 3 && skierY <= k.y + 2) || null;
  }
  function knockedByIce(k) {
    icefall.splice(icefall.indexOf(k), 1);
    speed *= 0.35;
    vx *= 0.3;
    SFX.playBreak();
    spawnExplosion(k.x, k.y - 2, PEN_PIECES);
    pop('ICEFALL!');
  }
  function smashChunk(k) {
    icefall.splice(icefall.indexOf(k), 1);
    burned.tree++;
    SFX.playExplosion();
    spawnExplosion(k.x, k.y - 2, PEN_PIECES);
    pop(`ICE +${BURN_POINTS.tree}`);
    paintHud();
  }
  function drawIcefall(camY) {
    for (const k of icefall) blit(CHUNK, Math.round(k.x) - 2, k.y - camY - 3);
  }

  // How loud and shaky it is, 0..1.
  const slideLevel = () => !slide || state !== 'running' ? 0
    : slide.rumble > 0 ? 0.3 + 0.5 * (1 - slide.rumble / SLIDE_RUMBLE)
    : slide.v > 0 ? Math.max(0.5, Math.min(1, 1 - (skierY - slide.y - SLIDE_HOLD) / 80)) : 0;

  // On fire, a tree the skis have just gone past close by catches too.
  // Only once it's behind the skier, so it can't steal a hit. Scenery only.
  const SCORCH_REACH = 9;
  function scorchPassed() {
    const { salt, centerAt } = course;
    const i0 = Math.floor((skierX - SCORCH_REACH - 4) / TREE_CELL), i1 = Math.floor((skierX + SCORCH_REACH + 4) / TREE_CELL);
    const j0 = Math.floor((skierY - 12) / TREE_CELL), j1 = Math.floor(skierY / TREE_CELL);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const key = i + ',' + j;
        if (scorched.has(key) || exploded.has(key)) continue;
        const tr = treeAt(i, j, salt, centerAt);
        if (!tr || tr.pine || tr.rock || tr.pen || tr.ice) continue;
        if (Math.abs(skierX - tr.x) <= SCORCH_REACH && skierY > tr.y + 2 && skierY <= tr.y + 10) {
          scorched.set(key, { at: performance.now(), god: runGod, hit: false });
        }
      }
    }
  }

  // ---------------------------------------------------------------- render
  // Speckles are hashed on WORLD coordinates so the snow scrolls with the
  // slope instead of shimmering in place.
  function hash(x, y) {
    let h = (x * 374761393 + y * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  // 0 on the piste, rising to 1 at the screen edge on whichever side x is.
  // Normalising to the edge means the far margin is always full depth, no
  // matter where the piste has wandered. Each edge wobbles with its own
  // noise, so the piste isn't a clean lane.
  function snowDepth(x, center, y) {
    const left = x < center;
    const hw = pisteHW(y) + noise2(y / 22, left ? 3.5 : 9.5) * EDGE_WOBBLE;
    const d = Math.abs(x - center);
    if (d <= hw) return 0;
    const span = (left ? center : W - center) - hw;
    return Math.min(1, (d - hw) / Math.max(1, span));
  }

  // Smooth value noise, about one bump per `scale` pixels. Breaks the snow
  // into drifts instead of a clean gradient.
  function noise2(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = hash(xi + 1013, yi - 777), b = hash(xi + 1014, yi - 777);
    const c = hash(xi + 1013, yi - 776), d = hash(xi + 1014, yi - 776);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }

  // At most one tree per TREE_CELL square, placed by hash so it's stable
  // as the slope scrolls. Rendering and collision both ask this, so a tree
  // you can see is exactly a tree you can hit. Now and then a cell holds a
  // pineapple instead, which is just as solid and a lot louder.
  function treeAt(i, j, salt, centerAt) {
    let x = i * TREE_CELL + 2 + Math.floor(hash(i * 7 + salt, j * 3 + 1) * (TREE_CELL - 4));
    const y = j * TREE_CELL + 2 + Math.floor(hash(i * 5 + salt, j * 11 + 7) * (TREE_CELL - 4));
    // Nothing grows through a safety net: step it aside, staying on the
    // side of the net it was on.
    if (course && course.nets) {
      for (const n of course.nets) {
        if (y < n.y0 || y - 8 > n.y1) continue;
        // Where the net runs over the tree's rows, both strands.
        let lo = Infinity, hi = -Infinity;
        for (let r = Math.max(y - 8, n.y0); r <= Math.min(y, n.y1); r++) {
          const nx = netX(r, n.side);
          lo = Math.min(lo, nx, nx + n.side); hi = Math.max(hi, nx, nx + n.side);
        }
        if (x + 5 >= lo && x - 5 <= hi) x = x >= (lo + hi) / 2 ? hi + 6 : lo - 6;
      }
    }
    if (course && Math.abs(x - course.titlePine.x) < 10 && Math.abs(y - course.titlePine.y) < 12) return null;
    if (course && course.inCouloir && course.inCouloir(y)) return null;   // nothing grows on the rock
    if (course && course.fanZone && course.fanZone(x, y)) return null;
    if (course && course.shape && course.shape.serac) {   // nothing on the serac's ice
      const sr = course.shape.serac;
      if (y > sr.from * course.finishY - 30 && y < sr.to * course.finishY + 30 && sr.side * (x - centerAt(y)) > pisteHW(y)) return null;
    }
    if (course && course.signs && course.signs.some(g => x > g.x0 - 6 && x < g.x0 + g.wd + 6 && y > g.top - 10 && y < g.y + 10)) return null;
    const cp = course && course.camp;
    if (cp && x > cp.x - 10 && x < cp.x + cp.w + 10 && y > cp.y - 4 && y < cp.y + cp.h + 12) return null;
    const depth = snowDepth(x, centerAt(y), y);
    // Endless puts more on the piste the harder it gets.
    const crowd = !course ? 1 : course.endless ? 1 + 2 * course.levelAt(y) : course.shape.crowd;
    const morePines = course && course.shape ? course.shape.pines : 1;
    const pineChance = (depth <= 0 ? PINE_CHANCE * PINE_PISTE * crowd : PINE_CHANCE) * morePines;
    const pine = hash(i * 48271 + salt, j * 13 + 5) < pineChance && pineIsFair(x, y);
    let debris = 0;
    if (pine) {
      // Anywhere at all, so no tree chance to pass.
    } else if (depth <= 0) {
      // The odd tree on the piste itself, never on the racing line.
      const more = course && !course.endless ? course.shape.crowd : 1;
      // A rockfall leaves boulders all over the piste, though never on the line.
      debris = (course && course.debrisAt ? course.debrisAt(y) : 0) + (course && course.penField && course.penField(x, y) ? 0.3 : 0);
      if (hash(i * 92821 + salt, j) >= PISTE_TREE * more + debris || !lineIsClear(x, y)) return null;
    } else {
      let chance = (TREE_EDGE + (TREE_MAX - TREE_EDGE) * depth) * (course && course.shape ? course.shape.forest : 1);
      if (course && course.shape && y < course.shape.treeline * course.finishY) chance *= 0.55;   // above the treeline
      if (course && course.penField && course.penField(x, y)) chance = Math.max(chance, 0.6);   // a field is packed
      if (hash(i * 92821 + salt, j) >= chance) return null;
    }
    if (!pine && course && course.iceAt && course.iceAt(x, y)) return null;
    // Keep clear of fences, so the two never overlap.
    const side = x < centerAt(y) ? -1 : 1, k = Math.floor(y / FENCE_SLOT);
    for (let kk = k - 1; kk <= k + 1; kk++) {
      const f = fenceAt(kk, side, salt, centerAt);
      if (f && Math.abs(y - f.y) <= 10 && x >= f.x0 - 5 && x <= f.x1 + 5) return null;
    }
    // Some mountains swap trees for boulders: one of three shapes.
    // In a penitente field, whatever stands there is a cluster of blades.
    const pen = !pine && !!(course && course.penField && course.penField(x, y));
    const above = !!(course && course.shape && y < course.shape.treeline * course.finishY);
    const rock = !pine && !pen && course && course.shape && (debris > 0 || above || hash(i * 3571 + salt, j * 7 + 2) < course.shape.rocks)
      ? 1 + Math.floor(hash(i * 911 + salt, j * 5 + 3) * ROCKS.length) : 0;
    // Cherries grow in groves: patches of smooth noise, which spread and
    // join up as the course's share of them rises.
    const cherry = !pine && !rock && course && course.cherryAt &&
      noise2(i / 3 + (salt % 89), j / 3 + 17) < course.cherryAt(y) * 1.1;
    // Rātā grow in clumps too: smaller patches of their own noise.
    const rata = !pine && !rock && !cherry && course && course.shape && course.shape.rata > 0 &&
      noise2(i / 2 + 300 + (salt % 61), j / 2 + 41) < course.shape.rata;
    const bush = !pine && !rock && !cherry && !rata && !!(course && course.shape && course.shape.bushes);
    const groundsel = !pine && !rock && !cherry && !rata && !!(course && course.shape && course.shape.groundsels);
    const iceBlock = !pine && !rock && !cherry && !rata && !!(course && course.shape && course.shape.icy);
    return { i, j, x, y, pine, rock, cherry, rata, bush: bush && !pen, groundsel: groundsel && !pen, pen, ice: iceBlock && !pen };
  }

  // True if something deadly at (x, y) leaves the racing line and the
  // poles open. Only a course has a line; the title slope keeps its piste
  // clear. The margin is generous because the line swings faster than a
  // skier can steer at speed, so anyone following it runs a little wide.
  function lineIsClear(x, y) {
    // Nothing on the piste until past the first pole, nor in the run-in
    // after the last, where you run straight on from wherever that pole
    // left you.
    if (!course || y < START_PAD + 30 || y > course.lineEnd - 10) return false;
    if (Math.abs(x - course.lineAt(y)) < CLEAR_LINE) return false;
    for (const p of course.poles) {
      if (Math.abs(p.y - y) <= 12 && Math.abs(x - p.x) < CLEAR_POLE) return false;
    }
    return true;
  }

  // Pineapples can sit anywhere on a course, the racing line too, but
  // never before the first pole (you'd start into one) or beside a pole,
  // so every pole can still be passed on its flag side. The title slope
  // places its own.
  function pineIsFair(x, y) {
    if (!course || y < START_PAD) return false;
    for (const p of course.poles) {
      if (Math.abs(p.y - y) <= 12 && Math.abs(x - p.x) < CLEAR_POLE) return false;
    }
    return true;
  }

  // A fence piece lying across the snow on one side of the piste: world
  // row y, from x0 to x1. Placed by hash per slot, like the trees. Most
  // start out in the fresh snow; some reach into the piste, but stop short
  // of the racing line.
  function fenceAt(k, side, salt, centerAt) {
    if (hash(k * 613 + salt, side + 71) >= FENCE_CHANCE * (course && course.shape ? course.shape.fences : 1)) return null;
    const y = k * FENCE_SLOT + Math.floor(hash(k * 37 + salt, side + 5) * (FENCE_SLOT - 8));
    if (course && course.inCouloir && course.inCouloir(y)) return null;
    const c = centerAt(y);
    const len = 16 + Math.floor(hash(k * 91 + salt, side + 13) * 22);
    let a;
    const intrude = INTRUDE_CHANCE * (course && course.endless ? 1 + course.levelAt(y) : 1);
    const hw = pisteHW(y);
    if (course && hash(k * 17 + salt, side + 41) < intrude) {
      a = Math.round(c + side * (hw - 4 - hash(k * 23 + salt, side + 3) * (INTRUDE_MAX - 4)));
      // The line runs inside the piste edge, so backing out reaches clear.
      while (!lineIsClear(a, y) && Math.abs(a - c) < hw + EDGE_WOBBLE) a += side;
    } else {
      const edge = c + side * (hw + EDGE_WOBBLE);
      const room = side < 0 ? edge : W - edge;
      if (room < len + 8) return null;
      a = Math.round(edge + side * (4 + Math.floor(hash(k * 53 + salt, side + 29) * (room - len - 4))));
    }
    const b = Math.max(0, Math.min(W - 1, a + side * len));
    const x0 = Math.min(a, b), x1 = Math.max(a, b);
    // Never in a crowd, nor across a safety net: such a fence just isn't there.
    if (course && course.fanZone && course.fanZone((x0 + x1) / 2, y)) return null;
    const sr = course && course.shape && course.shape.serac;
    if (sr && y > sr.from * course.finishY - 30 && y < sr.to * course.finishY + 30 && side === sr.side) return null;
    if (course && course.nets && course.nets.some(n => y >= n.y0 - 6 && y <= n.y1 + 6 &&
      netX(y, n.side) >= x0 - 3 && netX(y, n.side) <= x1 + 3)) return null;
    return { y, x0, x1 };
  }

  // ------------------------------------------------------------- animals
  // Wolves, foxes and bears at the forest edge. Where they stand comes from
  // the course, like the trees; once in view they wander about their spot,
  // and stop to watch the skier go by. Get close and one may give chase
  // (odds, within radius), at a fraction of the skier's speed (pace), so it
  // only catches a skier it can cut off, until its patience runs out. Only
  // a bear can crash you that way; once one gives up it's harmless. Solid,
  // unless the skier is on fire.
  const ANIMALS = {
    wolf: { ink: VIC.blue, reach: 5, tall: 6, odds: 0.15, radius: 46, pace: 0.85, patience: 2.5, bonus: 100,
      stand: ['........XX', 'X......XXK', '.XXXXXXXX.', '.XXXXXXX..', '.X.X..X.X.', '.X.X..X.X.'],
      walk: [['..........', 'X.......XX', '.XXXXXXXXK', '.XXXXXXX..', '.X..X.X..X', '.X..X.X..X'],
             ['..........', 'X.......XX', '.XXXXXXXXK', '.XXXXXXX..', '..XX...XX.', '..XX...XX.']] },
    fox: { ink: VIC.orange, reach: 4, tall: 5, odds: 0.3, radius: 46, pace: 0.8, patience: 2, bonus: 50,
      stand: ['......XX', 'X.....XK', 'XX.XXXX.', '.XXXXX..', '..X..X..'],
      walk: [['........', 'X.....XX', 'XX.XXXXK', '.XXXXX..', '.X....X.'],
             ['........', 'X.....XX', 'XX.XXXXK', '.XXXXX..', '...XX...']] },
    bear: { ink: VIC.red, reach: 7, tall: 7, odds: 0.8, radius: 52, pace: 0.95, patience: 9, bonus: 300,
      stand: ['.........XX.', '..XXXXX.XXXX', '.XXXXXXXXXXK', 'XXXXXXXXXXX.', 'XXXXXXXXXX..', '.XX.XX.XX.XX', '.XX.XX.XX.XX'],
      walk: [['............', '..XXXXX..XX.', '.XXXXXXXXXXX', 'XXXXXXXXXXXK', 'XXXXXXXXXX..', '.XX..XX.XX..', 'XX....XX.XX.'],
             ['............', '..XXXXX..XX.', '.XXXXXXXXXXX', 'XXXXXXXXXXXK', 'XXXXXXXXXX..', '..XX.XX..XX.', '.XX.XX..XX..']] },
  };
  // Stray dogs (Aconcagua): they run out and trot along beside you for a
  // while, then wander off. Friendly, but solid.
  ANIMALS.dog = { ink: VIC.black, reach: 4, tall: 5, odds: 0.85, radius: 55, patience: 5, bonus: 0,
    stand: ['X......XX', 'X.....XXK', '.XXXXXXX.', '.XXXXXX..', '.X.X.X.X.'],
    walk: [['X.......X', 'X.....XXX', '.XXXXXXXK', '.XXXXXX..', 'X..X.X..X'],
           ['X.......X', 'X.....XXX', '.XXXXXXXK', '.XXXXXX..', '.XX...XX.']] };
  const DOG_INKS = [VIC.black, VIC.black, VIC.orange, VIC.red];
  ANIMALS.dog.escort = true;
  // Kea (Aoraki): the cheeky alpine parrot, green with an orange flash
  // under the wings. Like a dog, it tags along for a bit.
  // It flies, so it's never in the way.
  ANIMALS.kea = { ink: VIC.green, reach: 3, tall: 4, odds: 0.85, radius: 50, patience: 4, bonus: 0, escort: true, flies: true,
    stand: ['..XXK', '.XXX.', 'XXXX.', '.O.O.'],
    walk: [['O.XXK', '.XXXO', 'XXXX.', '.O.O.'], ['..XXK', 'OXXX.', 'XXXXO', '.O.O.']] };
  // Penguins (Vinson): black backs, white fronts, orange beaks and feet.
  // They waddle and watch; that's all.
  ANIMALS.penguin = { ink: VIC.black, reach: 3, tall: 6, odds: 0, radius: 40, patience: 0, bonus: 0,
    stand: ['.XX..', 'XWWXO', 'XWWX.', 'XWWX.', '.XX..', 'O..O.'],
    walk: [['.XX..', 'XWWXO', 'XWWX.', 'XWWX.', '.XX..', 'O....'], ['.XX..', 'XWWXO', 'XWWX.', 'XWWX.', '.XX..', '...O.']] };
  // Snow leopards (the Himalaya and Karakoram): pale, spotted, very shy.
  // They watch; they never chase.
  ANIMALS.leopard = { ink: VIC.lightBlue, reach: 5, tall: 5, odds: 0, radius: 46, patience: 0, bonus: 0,
    stand: ['.........XX', 'X......XXXK', 'XXXKXXKXXX.', '.XKXXXXKX..', '.X.X...X.X.'],
    walk: [['...........', 'X.......XXX', 'XXXKXXKXXXK', '.XKXXXXKX..', 'X..X.X..X..'],
           ['...........', 'X.......XXX', 'XXXKXXKXXXK', '.XKXXXXKX..', '.XX...XX...']] };
  // The four-legged ones seen from above, heading down the slope: tail
  // at the top, head at the bottom, legs trotting in diagonal pairs.
  // Drawn when they're moving more up or down than sideways (flipped,
  // head first, going up).
  function topDown(bodyW, len, tail, head, coat = null) {
    const W = bodyW + 2, pad = '.';
    const frame = (a) => {
      const body = [];
      for (let r = 0; r < len; r++) {
        const mid = coat ? coat[r % coat.length] : 'X'.repeat(bodyW);
        // back legs on the first two rows, front legs on the last two
        const legRow = r < 2 ? r : r >= len - 2 ? r - (len - 2) : -1;
        const b = r < 2 ? a : !a;   // front legs opposite the back: a trot
        const left = legRow >= 0 && (legRow === 0) === b, right = legRow >= 0 && (legRow === 1) === b;
        body.push((left ? 'X' : pad) + mid + (right ? 'X' : pad));
      }
      return [...tail, ...body, ...head];
    };
    return [frame(true), frame(false)].map(f => f.map(r => r.padEnd(W, '.')));
  }
  ANIMALS.wolf.top = topDown(3, 5, ['..X..', '..X..'], ['X.X.X', 'XXXXX', '.XXX.', '..K..']);
  ANIMALS.fox.top = topDown(3, 3, ['..W..', '.XXX.'], ['X.X.X', '.XXX.', '..K..']);
  ANIMALS.bear.top = topDown(5, 6, ['...X...'], ['.X.X.X.', '.XXXXX.', '..XXX..', '...K...']);
  ANIMALS.dog.top = topDown(3, 4, ['..X..'], ['XXXXX', '.XXX.', '..K..']);
  ANIMALS.leopard.top = topDown(3, 5, ['...X.', '..X..', '..X..'], ['X.X.X', 'XXXXX', '.XKX.'], ['XKX', 'XXX', 'KXX', 'XXK', 'XKX']);

  const ANIMAL_SLOT = 70;           // at most one per side per this many rows
  const ANIMAL_ODDS = 0.005;        // chance per slot and side, extremely rare...
  const ANIMAL_ODDS_ENDLESS = 0.024; // ...and more often here
  const FOX_PAIR = 0.3;             // chance a fox has company
  const ANIMAL_ROAM = 12;           // how far one wanders from its spot
  const ANIMAL_WATCH = 70;          // the skier within this: stop and look
  const BEAR_CATCH = 9;             // a chasing bear this close has you
  let animals = [], animalSlot = 0;

  // Who's in slot k on this side, if anyone. Never within wandering reach
  // of the racing line.
  function animalAt(k, side) {
    const { centerAt, endless } = course, salt = course.salt + animalSalt;
    const dogs = course.shape.dogs, wild = course.shape.wildlife;
    if (hash(k * 719 + salt, side + 83) >= (dogs || (wild && wild.odds) || (endless ? ANIMAL_ODDS_ENDLESS : ANIMAL_ODDS))) return null;
    const y = k * ANIMAL_SLOT + Math.floor(hash(k * 41 + salt, side + 7) * (ANIMAL_SLOT - 20));
    const x = Math.round(centerAt(y) + side * (pisteHW(y) + 6 + hash(k * 59 + salt, side + 19) * 14));
    if (x < 10 || x > W - 10 || y > course.finishY - 40) return null;
    if (course.inCouloir && course.inCouloir(y + 20)) return null;
    if (Math.abs(x - course.lineAt(y)) < CLEAR_LINE + ANIMAL_ROAM) return null;
    const roll = hash(k * 137 + salt, side + 53);
    let kind = dogs ? 'dog' : roll < 0.67 ? 'fox' : roll < 0.92 ? 'wolf' : 'bear';
    if (wild && !dogs) {   // this mountain's own, by weight
      const ks = Object.entries(wild.kinds), total = ks.reduce((t, [, w]) => t + w, 0);
      let r = roll * total;
      kind = ks.find(([, w]) => (r -= w) < 0)[0];
    }
    return { kind, x, y, homeX: x, homeY: y,
      mode: 'pause', t: Math.random() * 2, face: side, toX: x, toY: y, side,
      ink: dogs ? DOG_INKS[Math.floor(roll * DOG_INKS.length)] : null };
  }

  // Worth more the rarer the animal; also in slalom_submit.
  function survivedChase(a) {
    survived[a.kind]++;
    pop(`SURVIVED ${a.kind.toUpperCase()} CHASE !!! +${ANIMALS[a.kind].bonus}`);
    SFX.playDing();
    paintHud();
  }

  function updateAnimals(dt) {
    const camY = cameraTop();
    for (; animalSlot * ANIMAL_SLOT < camY + H + 40; animalSlot++) {
      for (const side of [-1, 1]) {
        const a = animalAt(animalSlot, side);
        if (!a) continue;
        animals.push(a);
        if (a.kind === 'fox' && hash(animalSlot * 311 + course.salt, side + 29) < FOX_PAIR) {
          const x = a.x + side * 12, y = a.y + 6;   // further from the piste
          animals.push({ ...a, x, y, homeX: x, homeY: y, toX: x, toY: y, t: a.t + 0.7 });
        }
      }
    }
    for (const a of animals) if (a.mode === 'chase' && a.y <= camY - 40 && state === 'running') survivedChase(a);
    animals = animals.filter(a => a.y > camY - 40);
    for (const a of animals) {
      const k = ANIMALS[a.kind], dist = Math.hypot(a.x - skierX, a.y - skierY);
      if (a.mode === 'escort') {   // a dog trotting along beside you
        a.t -= dt;
        if (state !== 'running' || a.t <= 0) { dogLeaves(a); continue; }
        const tx = skierX + a.side * 14 - a.x, ty = skierY + 3 - a.y, d = Math.hypot(tx, ty) || 1;
        const v = Math.min(d * 6, Math.max(speed * 1.2, 50));
        a.x += tx / d * v * dt; a.y += ty / d * v * dt;
        a.face = Math.abs(tx) > 3 ? Math.sign(tx) : a.face;
        continue;
      }
      if (a.mode === 'leave') {    // off it goes, back up the side
        a.x += a.side * 40 * dt; a.y -= 10 * dt; a.face = a.side;
        continue;
      }
      if (k.escort && !a.rolled && state === 'running' && dist < k.radius) {
        a.rolled = true;
        if (Math.random() < k.odds) { a.mode = 'escort'; a.t = k.patience + Math.random() * 3; SFX.playBark(); continue; }
      }
      if (a.mode === 'chase') {
        a.t -= dt;
        if (state !== 'running' || a.t <= 0) {   // lost interest, right here
          if (state === 'running') survivedChase(a);
          a.mode = 'pause'; a.t = 1 + Math.random() * 2; a.tame = true;
          a.homeX = a.x; a.homeY = a.y;
        } else {
          if (dist > 10 || a.kind === 'bear') {   // a wolf or fox only trails
            const v = speed * k.pace;
            // A bear runs at where you're going, so it can cut you off.
            const lead = a.kind === 'bear' ? dist / Math.max(v, 1) : 0;
            const tx = skierX + vx * lead - a.x, ty = skierY + speed * lead - a.y, len = Math.hypot(tx, ty) || 1;
            a.x += tx / len * v * dt;
            a.y += ty / len * v * dt;
          }
          a.face = skierX >= a.x ? 1 : -1;
          continue;
        }
      }
      if (!a.rolled && state === 'running' && dist < k.radius) {
        a.rolled = true;
        if (Math.random() < k.odds) {
          a.mode = 'chase'; a.t = k.patience;
          if (a.kind === 'bear') SFX.playGrowl();
          continue;
        }
      }
      if (Math.abs(a.y - skierY) < ANIMAL_WATCH && Math.abs(a.x - skierX) < ANIMAL_WATCH + 20) {
        a.mode = 'watch';
        a.face = skierX >= a.x ? 1 : -1;
        continue;
      }
      if (a.mode === 'watch') { a.mode = 'pause'; a.t = 1 + Math.random() * 2; }
      a.t -= dt;
      if (a.t <= 0) {
        if (a.mode === 'pause') {
          a.mode = 'walk';
          a.t = 1 + Math.random() * 2;
          a.toX = a.homeX + (Math.random() * 2 - 1) * ANIMAL_ROAM;
          a.toY = a.homeY + (Math.random() * 2 - 1) * ANIMAL_ROAM / 2;
          a.face = a.toX >= a.x ? 1 : -1;
        } else { a.mode = 'pause'; a.t = 1 + Math.random() * 2; }
      }
      if (a.mode === 'walk') {
        const dx = a.toX - a.x, dy = a.toY - a.y, d = Math.hypot(dx, dy);
        if (d < 1) { a.mode = 'pause'; a.t = 1 + Math.random() * 2; }
        else { a.x += dx / d * 9 * dt; a.y += dy / d * 9 * dt; }
      }
    }
  }

  // An animal (any kind) heads off up the side of the slope, away from
  // the piste, and leaves you be.
  function dogLeaves(a) {
    a.mode = 'leave'; a.tame = true;
    a.side = a.x < course.centerAt(a.y) ? -1 : 1;
  }

  function hitAnimal(x, y) {
    for (const a of animals) {
      const k = ANIMALS[a.kind];
      if (a.tame || k.flies || (a.mode === 'chase' && a.kind !== 'bear')) continue;
      // A dog alongside only counts if you steer into it, not it into you.
      if (a.mode === 'escort' && Math.sign(vx) !== Math.sign(a.x - x)) continue;
      const caught = a.mode === 'chase' && Math.hypot(x - a.x, y - a.y) <= BEAR_CATCH;
      if (caught || (Math.abs(x - a.x) <= k.reach && y >= a.y - k.tall - 2 && y <= a.y + 2)) {
        return { animal: true, kind: a.kind, x: a.x, y: a.y, a };
      }
    }
    return null;
  }

  function drawAnimals(camY) {
    for (const a of animals) {
      const k = ANIMALS[a.kind];
      const moving = a.mode === 'walk' || a.mode === 'chase' || a.mode === 'escort' || a.mode === 'leave';
      // Which way it's actually going, smoothed, with a little give so it
      // doesn't flicker between views on a diagonal.
      const dx = a.x - (a.ox ?? a.x), dy = a.y - (a.oy ?? a.y);
      a.ox = a.x; a.oy = a.y;
      a.mx = (a.mx || 0) * 0.85 + dx * 0.15; a.my = (a.my || 0) * 0.85 + dy * 0.15;
      if (Math.abs(a.my) > 1.15 * Math.abs(a.mx)) a.vert = true;
      else if (Math.abs(a.mx) > 1.15 * Math.abs(a.my)) a.vert = false;
      const frame = Math.floor(performance.now() / (a.mode === 'chase' ? 80 : 160)) % 2;
      let rows;
      if (moving && a.vert && k.top) rows = a.my < 0 ? k.top[frame].slice().reverse() : k.top[frame];
      else {
        rows = moving ? k.walk[frame] : k.stand;
        if (a.face < 0) rows = rows.map(r => r.split('').reverse().join(''));
      }
      blit(rows, Math.round(a.x) - (rows[0].length >> 1), Math.round(a.y) - camY - rows.length + 1, a.ink || k.ink);
    }
  }

  // Birds crossing the screen overhead, side-on like everything else: small flocks of
  // blackbirds and the odd bald eagle. Screen coordinates, so they cross at
  // their own pace however fast the slope goes by. Nothing can hit them.
  const BIRD = [
    ['..X..', '.X.X.', 'X...X'],
    ['X...X', '.X.X.', '..X..'],
  ];
  // A blackbird writ large, with a white head and yellow beak leading
  // the way. Faces right; flipped when flying left.
  const EAGLE = [
    ['X.........X', '.X.......X.', '..X.....X..', '...X...X...', '....XXXWY..', '.......K...'],
    ['.......K...', '....XXXWY..', '...X...X...', '..X.....X..', '.X.......X.', 'X.........X'],
  ];
  const BIRD_EVERY = [150, 300];       // seconds between sightings...
  const BIRD_EVERY_ENDLESS = [40, 85]; // ...and in Endless
  const EAGLE_ODDS = 0.15;
  let birds = [], birdIn = 0;
  const between = ([a, b]) => a + Math.random() * (b - a);

  // Bogong moths: every so often a loose cloud of specks, a pixel each,
  // drifts across the screen, every moth fluttering on its own. Scenery.
  const MOTH_EVERY = [5, 10];
  let moths = [], mothIn = 3;
  function updateMoths(dt) {
    if (!course.shape.moths) { moths = []; return; }
    mothIn -= dt;
    if (mothIn <= 0) {
      mothIn = between(MOTH_EVERY);
      const dir = Math.random() < 0.5 ? 1 : -1, cy = 15 + Math.random() * (H - 60), v = dir * (18 + Math.random() * 12);
      const n = 14 + Math.floor(Math.random() * 14);
      for (let i = 0; i < n; i++) {
        moths.push({ x: (dir > 0 ? -6 : VW + 6) - dir * Math.random() * 40, y: cy + (Math.random() - 0.5) * 26,
          v: v * (0.8 + Math.random() * 0.4), ph: Math.random() * 6.3, ink: Math.random() < 0.6 ? VIC.orange : VIC.black });
      }
    }
    const now = performance.now() / 1000;
    // Where the skier is on screen, in the moths' own (screen) coordinates.
    const px = skierX - camX, py = skierY - cameraTop() - 2, live = state === 'running', fire = live && onFire();
    for (const m of moths) {
      const dx = m.x - px, dy = m.y - py, d = Math.hypot(dx, dy) || 1;
      // Moths to a flame: on fire, any that come near are drawn in and
      // circle you for a few seconds, then peel off.
      if (fire && !m.orbit && !m.done && d < 40) m.orbit = { a: Math.atan2(dy, dx), r: 5 + Math.random() * 7, left: 2.5 + Math.random() * 2 };
      if (m.orbit) {
        m.orbit.a += (5 + m.ph) * dt; m.orbit.left -= dt;
        m.x = px + Math.cos(m.orbit.a) * m.orbit.r; m.y = py + Math.sin(m.orbit.a) * m.orbit.r * 0.8;
        if (m.orbit.left <= 0 || !fire) { m.orbit = null; m.done = true; m.ex = Math.cos(m.ph) * 30; m.ey = -20; }
        continue;
      }
      // Ski through a swarm and it scatters, then drifts on.
      if (live && !fire && d < 11 && Math.hypot(m.ex || 0, m.ey || 0) < 8) { m.ex = dx / d * 55; m.ey = dy / d * 55; }
      m.ex = (m.ex || 0) * Math.exp(-2.5 * dt); m.ey = (m.ey || 0) * Math.exp(-2.5 * dt);
      m.x += (m.v + m.ex) * dt;
      m.y += (Math.sin(now * 9 + m.ph) * 14 + m.ey) * dt;
    }
    moths = moths.filter(m => m.orbit || (m.v > 0 ? m.x < VW + 10 : m.x > -10) && m.y > -20 && m.y < H + 20);
  }
  // Cherry petals: a few pink specks always drifting down and across.
  const PETALS = 16;
  let petals = [];
  function updatePetals(dt) {
    if (!course.shape.cherry) { petals = []; return; }
    const first = !petals.length;   // the first lot fill the screen; later ones come in at the top
    while (petals.length < PETALS) petals.push({ x: Math.random() * VW, y: first ? Math.random() * H : -4,
      vx: 6 + Math.random() * 10, vy: 10 + Math.random() * 8, ph: Math.random() * 6.3 });
    const now = performance.now() / 1000;
    for (const p of petals) { p.x += (p.vx + Math.sin(now * 3 + p.ph) * 12) * dt; p.y += p.vy * dt; }
    petals = petals.filter(p => p.y < H + 4 && p.x < VW + 4);
  }
  function drawPetals() {
    for (const p of petals) put(Math.round(camX + p.x), Math.round(p.y), VIC.pink);
  }

  function drawMoths() {
    const flick = Math.floor(performance.now() / 80);
    for (const m of moths) if ((flick + Math.round(m.ph * 10)) % 5) put(Math.round(camX + m.x), Math.round(m.y), m.ink);
  }

  function spawnBirds() {
    const dir = Math.random() < 0.5 ? 1 : -1, y = 10 + Math.random() * (H - 50);
    if (Math.random() < EAGLE_ODDS) {
      birds.push({ eagle: true, x: dir > 0 ? -14 : VW + 14, y, v: dir * (26 + Math.random() * 10), phase: Math.random() * 1000 });
      return;
    }
    const n = 3 + Math.floor(Math.random() * 4), v = dir * (44 + Math.random() * 16);
    for (let i = 0; i < n; i++) {
      birds.push({ x: (dir > 0 ? -8 : VW + 8) - dir * (i * 9 + Math.random() * 4),
        y: y + (Math.random() * 2 - 1) * (4 + i * 3), v, phase: Math.random() * 1000 });
    }
  }

  function updateBirds(dt) {
    birdIn -= dt;
    if (birdIn <= 0) {
      spawnBirds();
      birdIn = between(course.endless ? BIRD_EVERY_ENDLESS : BIRD_EVERY);
    }
    for (const b of birds) b.x += b.v * dt;
    birds = birds.filter(b => (b.v > 0 ? b.x < VW + 60 : b.x > -60));
  }

  function drawBirds() {
    const now = performance.now();
    for (const b of birds) {
      // An eagle mostly glides, with a few beats of the wings now and then.
      const beat = (now + b.phase) % 1800;
      const rows = b.eagle ? EAGLE[beat < 420 ? Math.floor(beat / 105) % 2 : 0]
        : BIRD[Math.floor((now + b.phase) / 110) % 2];
      const drawn = b.v < 0 ? rows.map(r => r.split('').reverse().join('')) : rows;
      blit(drawn, Math.round(camX + b.x) - (rows[0].length >> 1), Math.round(b.y), VIC.black);
    }
  }

  // Edge nets: runs of orange safety net just outside the piste's edge,
  // following it (placed in buildCourse, on the outside of bends).
  const NET_LEN = 70;
  const netX = (y, side) => Math.round(course.centerAt(y) + side * (course.widthAt(y) + 3));
  function hitEdgeNet(x, y) {
    const nets = course.nets || [];
    for (let k = 0; k < nets.length; k++) {
      const n = nets[k];
      if (y < n.y0 || y > n.y1) continue;
      const sc = scorched.get('e' + k);
      if (sc && y >= sc.gapY0 && y <= sc.gapY1) continue;
      if (Math.abs(x - netX(y, n.side)) <= 1.5) return { fence: true, net: true, k, x, y };
    }
    return null;
  }
  function drawEdgeNets(camY) {
    course.nets.forEach((n, k) => {
      if (n.y1 < camY || n.y0 > camY + H) return;
      const sc = scorched.get('e' + k), side = n.side;
      for (let y = Math.max(n.y0, camY); y <= Math.min(n.y1, camY + H); y++) {
        if (sc && y >= sc.gapY0 && y <= sc.gapY1) continue;
        const x = netX(y, side), sy = y - camY;
        // Two pixels deep: a solid strand and a mesh, black posts.
        if ((y - n.y0) % 8 === 0) { put(x, sy, VIC.black); put(x + side, sy, VIC.black); continue; }
        put(x, sy, VIC.netOrange);
        if (y % 2 === 0) put(x + side, sy, VIC.netOrange);
      }
    });
  }

  // A fence occupies rows y-4..y; the skier is fenced in when any of the
  // skier's rows meet it, give or take a pixel.
  function hitFence(x, y) {
    const { salt, centerAt } = course;
    const k0 = Math.floor((y - 10) / FENCE_SLOT), k1 = Math.floor((y + 10) / FENCE_SLOT);
    for (let k = k0; k <= k1; k++) {
      for (const side of [-1, 1]) {
        const f = fenceAt(k, side, salt, centerAt);
        if (f && !exploded.has(`f${k},${side}`) && y >= f.y - 7 && y <= f.y + 1 && x >= f.x0 - 2 && x <= f.x1 + 2) {
          return { fence: true, crevasse: !!course.shape.crevasses, k, side, x, y: f.y };
        }
      }
    }
    return null;
  }

  // Skier rows span y-4..y+4, a tree's y-8..y. A pixel or so of mercy on
  // each edge, so a brush past the canopy doesn't end the run. Returns
  // what was hit, or null.
  function hitTree(x, y) {
    const { salt, centerAt } = course;
    const i0 = Math.floor((x - 8) / TREE_CELL), i1 = Math.floor((x + 8) / TREE_CELL);
    const j0 = Math.floor((y - 8) / TREE_CELL), j1 = Math.floor((y + 12) / TREE_CELL);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const tr = treeAt(i, j, salt, centerAt);
        if (!tr || exploded.has(i + ',' + j) || scorched.has(i + ',' + j)) continue;
        // A pineapple is two pixels shorter and four narrower than a tree.
        const reach = tr.pine ? 3 : 5, top = tr.pine ? 8 : tr.rock ? ROCKS[tr.rock - 1].length + 1 : tr.bush ? 6 : tr.groundsel ? GROUNDSEL.length + 1 : tr.pen ? PENITENTE.length + 1 : tr.ice ? ICEBLOCK.length + 1 : 10;
        if (Math.abs(x - tr.x) <= reach && y >= tr.y - top && y <= tr.y + 2) return tr;
      }
    }
    const tp = course.titlePine;
    if (!exploded.has('t,t') && Math.abs(x - tp.x) <= 3 && y >= tp.y - 8 && y <= tp.y + 2) return tp;
    return null;
  }

  // Everything is drawn in world x; the window starts at camX.
  let camX = 0;
  function put(x, y, c) {
    x -= camX;
    if (x < 0 || x >= VW || y < 0 || y >= H) return;
    const i = (y * VW + x) * 4;
    img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = 255;
  }

  // 1 = ink. Each 7 wide, drawn centred on the skier.
  const SPRITES = {
    // Running straight: tucked, short pole ends trailing back uphill.
    down: [
      '.X.X.X.',
      '..XXX..',
      '..XXX..',
      '.X.X.X.',
      '..X.X..',
      '..X.X..',
      '..X.X..',
      '..X.X..',
    ],
    // Turning: crouched, knees bent and hips back, skis pointing the way
    // the skier is heading.
    left: [
      '...XX..',
      '..XXX..',
      '.X.XXX.',
      'X...XX.',
      '..XXX..',
      '..X.X..',
      '...X.X.',
      '..X.X..',
      '.X.X...',
      'X.X....',
    ],
    // Flipped into the snow: only legs and skis show.
    crash: [
      'X.....X',
      '.X...X.',
      '..X.X..',
      '..X.X..',
      '...X...',
    ],
  };
  SPRITES.right = SPRITES.left.map(r => r.split('').reverse().join(''));

  const TREE = [
    '....X....',
    '...XXX...',
    '...XXX...',
    '..XXXXX..',
    '..XXXXX..',
    '.XXXXXXX.',
    '.XXXXXXX.',
    'XXXXXXXXX',
    '....O....',
  ];

  // A pineapple in VIC colours: bushy crown, orange rind, smaller than a
  // tree.
  const PINEAPPLE = [
    'G.G.G',
    '.GGG.',
    '.OOO.',
    'OYOYO',
    'OOYOO',
    'OYOYO',
    '.OOO.',
  ];

  // On fire: three frames of flame licking up off the skier's head.
  const FLAMES = [
    ['...Y...', '.Y.O.Y.', '.OYRYO.', '..RRR..'],
    ['.Y...Y.', '.O.Y.O.', '.ROYOR.', '..RRR..'],
    ['..Y..Y.', '.YO.YO.', '.ORYRO.', '..RRR..'],
  ];

  // God mode's fire: the same flames, burning blue.
  const GOD_FLAMES = FLAMES.map(f => f.map(r => r.replace(/Y/g, 'C').replace(/O/g, 'B').replace(/R/g, 'V')));

  // X takes the ink passed in; the other letters are fixed colours.
  // Boulders, tree-wide and lower: round, craggy, snow-capped. Standing
  // on the tree's row, like a tree's trunk does.
  const ROCKS = [
    ['...VVV...',
     '..VBBVV..',
     '.VBVVVVV.',
     '.VVVVVKV.',
     'VVVVVKVVV',
     'VVKVVVVKV',
     '.KKKKKKK.'],
    ['..VV.....',
     '.VBBV.VV.',
     '.VVVVVBVV',
     'VVVKVVVVV',
     'VVKVVVKVV',
     '.KKKKKKKK'],
    ['..BBB....',
     '.BWWWB...',
     '.VVVVVV..',
     'VVBVVVVV.',
     'VVVVKVVVV',
     'VVVVVVKVV',
     'VKVVVVVVV',
     '.KKKKKKK.'],
  ];
  const ROCK_PIECES = [VIC.blue, VIC.blue, VIC.black, VIC.lightBlue];

  // Base camp: dome tents, an A-frame, and prayer flags on a line.
  const TENT_O = ['...OOOO...', '..OOOOOO..', '.OOYOOOOO.', '.OOYOKKOO.', 'OOOYOKKOOO', 'KKKKKKKKKK'];
  const TENT_Y = ['...YYYY...', '..YYYYYY..', '.YYOYYYYY.', '.YYOYKKYY.', 'YYYOYKKYYY', 'KKKKKKKKKK'];
  const TENT_A = ['...K...', '..OYO..', '.OOYOO.', '.OOKOO.', 'OOKKKOO', 'KKKKKKK'];
  // Blue, white (light blue, or it vanishes on snow), red, green, yellow.
  const PRAYER_FLAGS = (() => {
    const w = 22, h = 9, g = Array.from({ length: h }, () => Array(w).fill('.'));
    for (let y = 0; y < h; y++) { g[y][0] = 'K'; g[y][w - 1] = 'K'; }
    const lineY = x => 1 + Math.round(3 * Math.sin(Math.PI * x / (w - 1)));
    for (let x = 0; x < w; x++) g[lineY(x)][x] = 'K';
    [['V', 3], ['B', 7], ['R', 11], ['G', 15], ['Y', 18]].forEach(([c, x]) => {
      for (let dx = 0; dx < 2; dx++) for (let dy = 1; dy <= 2; dy++) g[lineY(x + dx) + dy][x + dx] = c;
    });
    return g.map(r => r.join(''));
  })();
  // The camp's layout, top-left origin: two flag lines over five tents.
  const CAMP = [
    [PRAYER_FLAGS, 2, 0], [PRAYER_FLAGS, 24, 2],
    [TENT_O, 0, 12], [TENT_Y, 13, 9], [TENT_A, 26, 13], [TENT_Y, 35, 10],
    [TENT_O, 6, 22], [TENT_A, 19, 21], [TENT_O, 30, 23],
  ];
  const CAMP_W = 46, CAMP_H = 29;
  // The tents (not the flags), as the boxes you can hit.
  const campTents = cp => CAMP.map(([spr, dx, dy], n) => ({ n, spr, x: cp.x + dx, y: cp.y + dy, w: spr[0].length, h: spr.length }))
    .filter(t => t.spr !== PRAYER_FLAGS);
  function hitTent(x, y) {
    const cp = course.camp;
    if (!cp || y < cp.y - 6 || y > cp.y + cp.h + 6) return null;
    for (const t of campTents(cp)) {
      if (exploded.has('tent' + t.n)) continue;
      if (x >= t.x && x <= t.x + t.w - 1 && y + 3 >= t.y && y - 3 <= t.y + t.h - 1) {
        return { tent: true, n: t.n, x: t.x + t.w / 2, y: t.y + t.h };
      }
    }
    return null;
  }
  function drawCamp(cp, camY) {
    if (cp.y + cp.h - camY < 0 || cp.y - camY > H) return;
    for (const [spr, dx, dy] of CAMP) if (spr === PRAYER_FLAGS) blit(spr, cp.x + dx, cp.y + dy - camY);
    for (const t of campTents(cp)) {
      const sc = scorched.get('tent' + t.n), x0 = t.x, y0 = t.y - camY;
      if (!sc) { blit(t.spr, x0, y0); continue; }
      // Set alight: flickering in the fire's colours, flames on top; then
      // a charred black shell.
      const age = performance.now() - sc.at, frame = Math.floor(performance.now() / 90);
      const colors = fireColors(sc.god);
      t.spr.forEach((row, r) => [...row].forEach((ch, c) => {
        if (ch === '.') return;
        put(x0 + c, y0 + r, age < POLE_BURN_MS ? colors[Math.floor(hash(c * 31 + r, frame + t.n) * 3)] : VIC.black);
      }));
      if (age < POLE_BURN_MS) for (let c = 1; c < t.w - 1; c += 2) flameUp(x0 + c, y0 + 1, sc.god, 4);
    }
  }

  // A chairlift seen from above: two cables, a pylon with its crossarm
  // every LIFT_GAP rows, chairs going up one side and down the other, some
  // with a skier aboard.
  const LIFT_GAP = 110, CHAIR_GAP = 30, CHAIR_SPEED = 7;
  const CHAIR_FULL = ['..K..', '.XXX.', 'KXXXK', 'K...K'];
  const CHAIR_EMPTY = ['KKKKK', 'K...K'];
  function drawLift(camY) {
    const x = course.liftX, now = performance.now() / 1000;
    for (let sy = 0; sy < H; sy++) {
      const wy = camY + sy;
      if ((wy & 1) === 0) { put(x - 3, sy, VIC.black); put(x + 3, sy, VIC.black); }
    }
    for (let p = Math.floor(camY / LIFT_GAP); p * LIFT_GAP < camY + H + 4; p++) {
      const sy = p * LIFT_GAP - camY;
      for (let dx = -5; dx <= 5; dx++) put(x + dx, sy, VIC.black);
      put(x, sy - 1, VIC.blue); put(x, sy + 1, VIC.blue); put(x - 1, sy, VIC.blue); put(x + 1, sy, VIC.blue);
    }
    for (const [cx, dir] of [[x - 3, -1], [x + 3, 1]]) {
      const shift = (now * CHAIR_SPEED * dir) % CHAIR_GAP;
      for (let wy = Math.floor(camY / CHAIR_GAP) * CHAIR_GAP - CHAIR_GAP; wy < camY + H + CHAIR_GAP; wy += CHAIR_GAP) {
        const y = Math.round(wy + shift) - camY, k = Math.round(wy / CHAIR_GAP);
        if (hash(k * 31 + (dir > 0 ? 5 : 0), 77) < 0.55) {   // someone riding, in a bright jacket
          blit(CHAIR_FULL, cx - 2, y - 2, FAN_INKS[Math.floor(hash(k * 17, dir + 9) * FAN_INKS.length)]);
        } else blit(CHAIR_EMPTY, cx - 2, y);
      }
    }
  }

  // The helicopter, from above: nose up, red cabin with a cyan canopy,
  // skids, a tail boom down towards the skier, and a rotor that's a blur
  // of spinning blades. It hovers through the countdown, then on GO pulls
  // up and away off the top of the screen.
  function heliAt(now) {
    if (!heli.leftAt) return { x: heli.x, y: heli.y + Math.round(Math.sin(now / 300)), t: 0 };
    const t = (now - heli.leftAt) / 1000;
    return { x: Math.round(heli.x + 20 * t * t), y: Math.round(heli.y - 25 * t - 110 * t * t), t };
  }
  function drawHeli(camY) {
    const now = performance.now(), { x, y: wy, t } = heliAt(now), y = wy - camY;
    if (t > 0 && y < -20) { heli = null; return; }
    for (let r = 5; r <= 12; r++) put(x, y + r, VIC.black);                 // tail boom
    const tf = Math.floor(now / 40) % 2;
    put(x - 1 + 2 * tf, y + 13, VIC.black); put(x, y + 13, VIC.black);      // tail rotor
    for (let r = -3; r <= 3; r++) { put(x - 5, y + r, VIC.black); put(x + 5, y + r, VIC.black); }   // skids
    blit(HELI_CAB, x - 3, y - 4);
    // The rotor: a faint disc where the blades blur, one blade showing.
    const a = now / 25;
    for (let k = 0; k < 24; k++) {
      const b = k * Math.PI / 12;
      if ((k + Math.floor(now / 60)) % 3) put(Math.round(x + Math.cos(b) * 11), Math.round(y + Math.sin(b) * 11), VIC.lightBlue);
    }
    for (let r = -11; r <= 11; r++) {
      if (Math.abs(r) < 2) continue;
      put(Math.round(x + Math.cos(a) * r), Math.round(y + Math.sin(a) * r), VIC.black);
    }
  }
  const HELI_CAB = [
    '..KKK..',
    '.KCCCK.',
    'KCCCCCK',
    'KRRRRRK',
    'KRRRRRK',
    'KRRRRRK',
    'KRRRRRK',
    '.KRRRK.',
    '..KKK..',
  ];
  // How loud the rotor is: full while hovering, fading as it flies off.
  const heliLevel = () => !heli || state === 'paused' || state === 'title' ? 0
    : !heli.leftAt ? 1 : Math.max(0, 1 - (performance.now() - heli.leftAt) / 1800);

  // Night: every row of the frame dims toward a deep night blue, more the
  // further down the course (never all the way: you can always read the
  // slope). A headlamp throws a cone of full light ahead down the hill,
  // leaning with your turns.
  const NIGHT = [12, 10, 60], LAMP_EDGE = [214, 190, 92], LAMP_LEN = 125, LAMP_HALF = 0.42;
  function nightfall(camY) {
    const dark = alongCourse(course.shape.night, course.finishY);
    const sx0 = Math.round(skierX) - camX, sy0 = Math.round(skierY) - camY - 2;
    const aim = Math.atan2(Math.max(speed, 20), vx * 0.8), lit = state === 'running' || state === 'finished' || state === 'countdown';
    const d = img.data;
    for (let sy = 0; sy < H; sy++) {
      const base = dark(camY + sy);
      if (base <= 0) continue;
      for (let sx = 0; sx < VW; sx++) {
        let light = 0;
        if (lit && !fellIn) {
          const dx = sx - sx0, dy = sy - sy0, r = Math.hypot(dx, dy);
          if (r < 7) light = 1;   // the glow around the skier
          else if (dy > 0 && r < LAMP_LEN) {
            const off = Math.abs(Math.atan2(dy, dx) - aim);
            if (off < LAMP_HALF) light = Math.min(1, (LAMP_HALF - off) / 0.12) * Math.min(1, (LAMP_LEN - r) / 25);
          }
        }
        light = light > 0.6 ? 1 : light > 0.25 ? 0.5 : 0;   // in hard steps, VIC-20 style
        const i = (sy * VW + sx) * 4;
        if (light === 0.5) {   // the beam's edge: a warm yellow fringe
          d[i] += (LAMP_EDGE[0] - d[i]) * 0.45; d[i + 1] += (LAMP_EDGE[1] - d[i + 1]) * 0.45; d[i + 2] += (LAMP_EDGE[2] - d[i + 2]) * 0.45;
          continue;
        }
        const k = base * (1 - light);
        if (k <= 0) continue;
        d[i] += (NIGHT[0] - d[i]) * k; d[i + 1] += (NIGHT[1] - d[i + 1]) * k; d[i + 2] += (NIGHT[2] - d[i + 2]) * k;
      }
    }
  }

  // The avalanche: churning snow from the top of the screen down to a
  // ragged front, a powder cloud dithered over it, big lumps tumbling
  // ahead. Once it stops, a still field of debris.
  function drawAvalanche(camY) {
    const now = performance.now(), live = slide.v > 0, tick = live ? Math.floor(now / 70) : 0;
    const bottom = Math.min(H - 1, Math.ceil(slide.y) + 3 - camY);
    for (let sy = 0; sy <= bottom; sy++) {
      const wy = camY + sy;
      for (let x = -MARGIN; x < W + MARGIN; x++) {
        const front = slide.y - 4 * noise2(x / 6, tick / 3) - 2 * noise2(x / 2, tick);
        if (wy > front) continue;
        const h = hash(x * 7 + 3, wy + tick * 17), deep = front - wy;
        put(x, sy, deep < 2 ? VIC.lightBlue : h < 0.22 ? VIC.lightBlue : h < 0.4 ? VIC.paleBlue : h < 0.46 && live ? VIC.cyan : VIC.white);
      }
    }
    if (!live) return;
    // Lumps rolling out ahead of the front.
    for (let k = 0; k < 9; k++) {
      const lx = Math.round(-MARGIN + hash(k + 3, Math.floor(now / 140)) * (W + 2 * MARGIN));
      const ly = Math.round(slide.y + 2 + 5 * hash(k, Math.floor(now / 90))) - camY;
      for (const [dx, dy, c] of [[0, 0, VIC.white], [1, 0, VIC.lightBlue], [-1, 0, VIC.white], [0, 1, VIC.lightBlue], [0, -1, VIC.white], [1, 1, VIC.blue]]) put(lx + dx, ly + dy, c);
    }
  }

  // Snowballs: a white ball shaded light blue underneath, a fleck turning
  // round it as it rolls, a ragged track behind. At rest, a lump.
  function drawSnowballs(camY) {
    for (const b of snowballs) {
      const by = Math.round(b.y) - camY, bx = Math.round(b.x);
      if (by < -12 - THROW_ARC || by > H + 12) continue;
      if (b.air) {   // its shadow on the snow, the ball up above it
        const t = b.air.t, lift = Math.round(4 * THROW_ARC * t * (1 - t)), r = b.r;
        for (let dx = -r; dx <= r; dx++) put(bx + dx, by, VIC.lightBlue);
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          const d = dx * dx + dy * dy;
          if (d <= r * r + r * 0.6) put(bx + dx, by - lift + dy, d > (r - 1) * (r - 1) + (r - 1) * 0.6 ? (dx + dy > r * 0.6 ? VIC.blue : VIC.lightBlue) : VIC.white);
        }
        continue;
      }
      // The track it ploughed, patchy.
      for (let y = Math.ceil(b.top); y < b.y - b.r; y += 2) {
        if (hash(bx * 3 + 1, y) < 0.5) continue;
        const ty = y - camY;
        if (ty >= 0 && ty < H) put(bx + Math.round(b.dx * (y - b.top) / Math.max(1, b.v0) ) + (hash(y, bx) < 0.5 ? -1 : 1) * Math.floor(hash(bx, y) * b.r), ty, VIC.white);
      }
      const r = b.r, still = b.v <= 0;
      // A shadow on the snow, down and to the right.
      for (let dx = -r + 1; dx <= r + 1; dx++) put(bx + dx, by + r + 1, VIC.lightBlue);
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const d = dx * dx + dy * dy, R = r * r + r * 0.6;
          if (d > R) continue;
          if (still && dy === -r) continue;   // settled: a little flatter on top
          const rim = d > (r - 1) * (r - 1) + (r - 1) * 0.6;
          const shade = dx + dy > r * 0.6;   // the lower right, away from the light
          put(bx + dx, by + dy, rim ? (shade ? VIC.blue : VIC.lightBlue) : shade ? VIC.paleBlue : VIC.white);
        }
      }
      if (!still) {   // the fleck going round
        const a = b.roll;
        put(bx + Math.round(Math.cos(a) * (r - 1)), by + Math.round(Math.sin(a) * (r - 1)), VIC.paleBlue);
      }
    }
  }

  // The sluff: a churning white tongue filling the gully behind you, light
  // blue swirling through it, a ragged front with lumps tumbling ahead.
  // Once it stops it lies still.
  function drawSluff(camY) {
    const now = performance.now(), live = sluff.v > 0, tick = live ? Math.floor(now / 70) : 0;
    const { c0 } = course.couloir;
    const top = Math.max(camY, c0), bottom = Math.min(camY + H, Math.ceil(sluff.y) + 3);
    for (let wy = top; wy <= bottom; wy++) {
      const c = Math.round(course.centerAt(wy)), hw = Math.ceil(course.widthAt(wy)) + 4;
      for (let x = c - hw; x <= c + hw; x++) {
        if (course.wall(x, wy)) continue;
        const front = sluff.y - 3 * noise2(x / 3, tick / 2);
        if (wy > front) continue;
        const h = hash(x * 7 + 1, wy + tick * 13);
        put(x, wy - camY, wy > front - 3 ? VIC.lightBlue : h < 0.32 ? VIC.lightBlue : h < 0.55 ? VIC.paleBlue : VIC.white);
      }
    }
    if (!live) return;
    // Lumps tumbling just ahead of the front.
    for (let k = 0; k < 4; k++) {
      const ly = Math.round(sluff.y + 2 + 3 * hash(k, tick)), c = course.centerAt(ly);
      const lx = Math.round(c + (hash(k + 9, tick) - 0.5) * 2 * course.widthAt(ly));
      if (course.wall(lx, ly)) continue;
      put(lx, ly - camY, VIC.white); put(lx + 1, ly - camY, VIC.lightBlue);
      put(lx, ly + 1 - camY, VIC.lightBlue); put(lx + 1, ly + 1 - camY, VIC.white);
    }
  }

  // Fans at the finish: standing about, now and then waving; once you're
  // over the line, jumping with their arms up. X is the jacket.
  const FAN_STAND = ['..K..', '.KKK.', 'XXXXX', 'X.X.X', 'X.X.X', '..X..', '.K.K.', '.K.K.'];
  const FAN_CHEER = ['X...X', 'X.K.X', 'XKKKX', '.XXX.', '..X..', '..X..', '.K.K.', '.K.K.'];
  const FAN_INKS = [VIC.red, VIC.blue, VIC.orange, VIC.green, VIC.red, VIC.lightBlue];
  // A photographer: camera up at the chest. Before you finish they snap
  // the blossom now and then; once you're over the line, it's all you.
  const FAN_PHOTO = ['..K..', '.KKK.', 'XXXXX', 'XKKKX', '.KKK.', '..X..', '.K.K.', '.K.K.'];
  function drawPhotographer(f, sy, now) {
    blit(FAN_PHOTO, f.x - 2, sy - 7, f.ink);
    const every = state === 'finished' ? 550 : 3100, at = (now + f.phase * 397) % every;
    if (at < 90) {   // the flash
      const fx = f.x, fy = sy - 5;
      put(fx, fy, VIC.white);
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) put(fx + dx, fy + dy, VIC.yellow);
      for (const [dx, dy] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) put(fx + dx, fy + dy, VIC.white);
    }
  }
  // The arena's barrier: advertising boards, blue and red, two pixels deep.
  const ARENA_RY = 46;
  function drawBarrier(camY) {
    const { cx, rx, ry, y } = course.arena;
    if (y - camY > H || y + ry + 2 - camY < 0) return;
    const steps = Math.ceil(Math.PI * (rx + ry));
    for (let i = 0; i <= steps; i++) {
      const th = i / steps * Math.PI, board = Math.floor(i / 6) % 2 ? VIC.blue : VIC.red;
      for (const d of [0, 1]) put(Math.round(cx + (rx + d) * Math.cos(th)), Math.round(y + (ry + d) * Math.sin(th)) - camY, board);
    }
  }
  // Penguins at the Vinson finish, facing up the piste: grown-ups with the
  // yellow neck patch, fluffy grey chicks, flippers up when they jump.
  const PENG_STAND = ['...KKK...', '..KKKKK..', '..YKOKY..', '..KWWWK..', '.KKWWWKK.', '.KKWWWKK.', '..KWWWK..', '...WWW...', '..OO.OO..'];
  const PENG_CHEER = ['...KKK...', '..KKKKK..', 'K.YKOKY.K', '.KKWWWKK.', '..KWWWK..', '..KWWWK..', '..KWWWK..', '...WWW...', '..OO.OO..'];
  const CHICK_STAND = ['.KKK.', 'KWKWK', '.WOW.', 'XXXXX', 'XXXXX', '.XXX.', '.O.O.'];
  const CHICK_CHEER = ['.KKK.', 'KWKWK', 'XWOWX', '.XXX.', '.XXX.', '.XXX.', '.O.O.'];
  const PENG_HAT = ['....W....', '...XXX...', '...XXX...'];   // a bobble hat, snug on the crown
  const PENG_SCARF = ['..XXXXX..', '......X..'];
  const PENGUIN_CROWD = 35;
  const PENGUIN_WOOL = [VIC.crimson, VIC.green, VIC.netOrange];   // one hat-and-scarf set each
  // Always hopping a little; when you cross the line, much higher and faster.
  function drawPenguinFan(f, sy, now) {
    const done = state === 'finished';
    const beat = Math.floor(now / (done ? 130 : 240)) + f.phase;
    const lift = done ? [0, 2, 3, 2][beat % 4] : beat % 3 === 0 ? 1 : 0;
    const up = lift > 0;
    if (f.chick) {
      blit(up ? CHICK_CHEER : CHICK_STAND, f.x - 2, sy - 7 - lift, VIC.lightBlue);
      return;
    }
    const x = f.x - 4, y = sy - 9 - lift;
    blit(up ? PENG_CHEER : PENG_STAND, x, y, VIC.black);
    if (f.hat) {
      blit(PENG_HAT, x, y - 2, f.hat);
      blit(PENG_SCARF, x, y + 3, f.hat);
    }
  }

  function drawFans(camY) {
    if (course.arena) drawBarrier(camY);
    const now = performance.now();
    for (const f of course.fans) {
      const sy = f.y - camY;
      if (sy < -6 || sy > H + 6) continue;
      if (f.camera) { drawPhotographer(f, sy, now); continue; }
      if (f.penguin) { drawPenguinFan(f, Math.round(sy), now); continue; }
      let spr = FAN_STAND, lift = 0;
      if (state === 'finished') {
        const beat = Math.floor(now / 170) + f.phase;
        spr = FAN_CHEER; lift = beat % 2;
      } else if ((Math.floor(now / 700) + f.phase) % 6 === 0) spr = FAN_CHEER;
      blit(spr, f.x - 2, sy - 7 - lift, f.ink);
    }
  }

  // A cherry tree in bloom: a round pink crown flecked white, on a trunk.
  // Same footprint as a pine, so it hits and burns the same.
  const CHERRY = [   // black branches spreading through it, a brown and black trunk
    '..PWPPP..',
    '.PPPPWPP.',
    'PWKPPPKPP',
    'PPPKPKPWP',
    '.PPPKOPP.',
    '..K.KO.K.',
    '....KO...',
    '....KO...',
    '...KKOO..',
  ];

  // A southern rātā in flower: a broad crimson crown with dark leaves
  // showing through, on a trunk. Same footprint as a pine.
  const RATA = [
    '..QQGQQ..',
    '.QQQQQGQ.',
    'QGQQQQQQQ',
    'QQQQGQQQQ',
    'QQQQQQQGQ',
    '.QGQQQQQ.',
    '..QQQGQ..',
    '....O....',
    '....O....',
  ];

  // Low scrub, wide and squat, darker twigs showing.
  const BUSH = [
    '...GGG...',
    '.GGGGGGG.',
    'GGGKGGGGG',
    'GGGGGGKGG',
    '.GGGGGGG.',
  ];

  // A giant groundsel: a forked trunk shaggy with dead leaves, a cabbage
  // of green leaves on top of each branch. Same footprint as a pine.
  const GROUNDSEL = [
    '.GGG.GGG.',
    'GGYGGGYGG',
    'GGGG.GGGG',
    '.GG...GG.',
    '..O...O..',
    '..O...O..',
    '..OO.OO..',
    '...OOO...',
    '....O....',
    '....O....',
    '....O....',
    '...OOO...',
  ];

  // Penitentes: a cluster of tall blades of hard snow, all leaning the
  // same way, outlined so they show against the snow, a shadow at the foot.
  const PENITENTE = [
    '.V...V...',
    '.CV..CV.V',
    '.WCV.WCVC',
    'VWCCVWCCV',
    'VWCCVWCCV',
    'VCCCVCCCV',
    'VCCCVCCCV',
    'BBBBBBBBB',
  ];
  const PEN_PIECES = [VIC.white, VIC.white, VIC.cyan, VIC.lightBlue];
  // Lumps of glacier ice, broken and uneven: a leaning slab, a jagged
  // serac, a low pile of shards. Blue edges, cyan and white faces.
  const ICE_SHAPES = [
    ['..VV.....',
     '.VWCV....',
     '.VWCCV...',
     'VCWCCCVV.',
     'VCCCWCCCV',
     'VCCCCCCVV',
     '.VVBBVVV.'],
    ['....V....',
     '...VWV.V.',
     '..VWCVVCV',
     '.VCWCCVCV',
     'VCCCCWCV.',
     'VVCCCCCVV',
     '.BBVVVBB.'],
    ['.........',
     '.........',
     '..V...V..',
     '.VCV.VWV.',
     'VWCCVCCCV',
     'VCCCCCWCV',
     '.BVVBVVB.'],
  ];
  const ICEBLOCK = ICE_SHAPES[0];
  // A tuft of tussock grass, drawn into the snow itself.
  const TUFT = ['Y.Y.Y', 'YYYYY', '.OYO.'];

  const INKS = { Q: VIC.crimson, P: VIC.pink, O: VIC.orange, G: VIC.green, Y: VIC.yellow, R: VIC.red,
    B: VIC.lightBlue, C: VIC.cyan, V: VIC.blue, K: VIC.black, W: VIC.white };

  // The on-screen arrows, in the same blocky pixels as everything else.
  const ARROW = [
    '...X...',
    '..XX...',
    '.XXXXXX',
    'XXXXXXX',
    '.XXXXXX',
    '..XX...',
    '...X...',
  ];
  document.querySelectorAll('.arrow-btn canvas').forEach((c) => {
    const actx = c.getContext('2d');
    const flip = c.parentElement.dataset.dir === 'right';
    actx.fillStyle = css(VIC.blue);
    ARROW.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch === 'X') actx.fillRect(flip ? 6 - x : x, y, 1, 1);
    }));
  });

  // snake-bit's button icons, gold on the blue buttons.
  function paintIcon(btn, rows) {
    const c = btn.querySelector('canvas');
    const ictx = c.getContext('2d');
    ictx.clearRect(0, 0, c.width, c.height);
    ictx.fillStyle = css(VIC.yellow);
    rows.forEach((row, y) => [...row].forEach((ch, x) => { if (ch === 'Y') ictx.fillRect(x, y, 1, 1); }));
  }
  const PAUSE_ICON = [
    '........',
    '.YY..YY.',
    '.YY..YY.',
    '.YY..YY.',
    '.YY..YY.',
    '.YY..YY.',
    '.YY..YY.',
    '........',
  ];
  const PLAY_ICON = [
    '........',
    '..Y.....',
    '..YYY...',
    '..YYYYY.',
    '..YYYYY.',
    '..YYY...',
    '..Y.....',
    '........',
  ];
  const MENU_ICON = [         // three lines: back to the title
    '........',
    '........',
    '.YYYYYY.',
    '........',
    '.YYYYYY.',
    '........',
    '.YYYYYY.',
    '........',
  ];
  const CROWN = [
    '........',
    '.Y.YY.Y.',
    '.Y.YY.Y.',
    '.YYYYYY.',
    '.Y.YY.Y.',
    '.YYYYYY.',
    '.YYYYYY.',
    '........',
  ];
  paintIcon(boardBtnEl, CROWN);
  paintIcon(restartBtnEl, MENU_ICON);
  // The pause button shows play while paused; repainted only on a change.
  let pauseIconPlay = null;
  function paintPauseIcon() {
    const play = state === 'paused';
    if (play === pauseIconPlay) return;
    pauseIconPlay = play;
    paintIcon(pauseBtnEl, play ? PLAY_ICON : PAUSE_ICON);
  }
  paintPauseIcon();

  // Line the TV's buttons up with the HUD boxes above them. BEST widens
  // with its digits, so this runs again whenever the HUD is painted.
  const tvEl = document.getElementById('tv');
  const hudBoxes = [...document.querySelectorAll('#hud > div')];
  function placeHudButtons() {
    if (NARROW || hudBoxes.length < 3) return;
    const tv = tvEl.getBoundingClientRect();
    const [s, m, b] = hudBoxes.map(el => el.getBoundingClientRect());
    pauseBtnEl.style.left = (s.left - tv.left) + 'px';
    restartBtnEl.style.left = (m.left + m.width / 2 - tv.left - restartBtnEl.offsetWidth / 2) + 'px';
    boardBtnEl.style.left = (b.right - tv.left - boardBtnEl.offsetWidth) + 'px';
  }
  window.addEventListener('resize', placeHudButtons);
  if (document.fonts) document.fonts.ready.then(placeHudButtons);

  // The title reads SUPER SLALOM VS <pineapple>, and the score card
  // carries one too; both drawn from the sprite.
  document.querySelectorAll('canvas.pine-icon').forEach((c) => {
    const tctx = c.getContext('2d');
    PINEAPPLE.forEach((row, y) => [...row].forEach((ch, x) => {
      if (!INKS[ch]) return;
      tctx.fillStyle = css(INKS[ch]);
      tctx.fillRect(x, y, 1, 1);
    }));
  });

  function blit(rows, x0, y0, ink) {
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < rows[r].length; c++) {
        const ch = rows[r][c];
        if (ch === 'X') put(x0 + c, y0 + r, ink);
        else if (INKS[ch]) put(x0 + c, y0 + r, INKS[ch]);
      }
    }
  }

  // A tiny 3x5 font for signs by the piste.
  const FONT3 = (() => {
    const g = {
      A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110',
      E: '111100110100111', F: '111100110100100', G: '011100101101011', H: '101101111101101',
      I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111',
      M: '101111111101101', N: '110101101101101', O: '010101101101010', P: '110101110100100',
      Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
      U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101',
      Y: '101101010010010', Z: '111001010100111',
      0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110',
      4: '101101111001001', 5: '111100110001110', 6: '011100111101111', 7: '111001010010010',
      8: '111101111101111', 9: '111101111001110',
      '%': '101001010100101', '!': '010010010000010', '-': '000000111000000', ' ': '000000000000000',
    };
    return g;
  })();
  function text3(str, x, y, ink) {
    for (let k = 0; k < str.length; k++) {
      const bits = FONT3[str[k]] || FONT3[' '];
      for (let b = 0; b < 15; b++) if (bits[b] === '1') put(x + k * 4 + (b % 3), y + Math.floor(b / 3), ink);
    }
  }
  // A board on two posts, just off the piste on whichever side has room,
  // its bottom edge on the sign's row.
  function drawSign(g, camY) {
    const { wd, ht, x0 } = g, by = g.y - camY, top = g.top - camY;
    if (by < -4 || top - 12 > H) return;
    for (let y = top; y < top + ht; y++)
      for (let x = x0; x < x0 + wd; x++)
        put(x, y, y === top || y === top + ht - 1 || x === x0 || x === x0 + wd - 1 ? VIC.blue : VIC.white);
    g.lines.forEach((l, i) => text3(l, x0 + 2 + Math.floor((wd - 3 - l.length * 4 + 1) / 2), top + 2 + i * 6, VIC.blue));
    for (const px of [x0 + 3, x0 + wd - 4]) for (let y = top + ht; y <= by; y++) put(px, y, VIC.black);
    if (g.flag) {
      // On a short pole on top of the board, flying right.
      const px = x0 + Math.floor(wd / 2) - 5;
      for (let y = top - 8; y < top; y++) put(px, y, VIC.black);
      FLAGS[g.flag].forEach((row, r) => [...row].forEach((ch, k) => put(px + 1 + k, top - 8 + r, INKS[ch] || VIC.white)));
    }
  }
  // Flags, read from the pole outward. W is white, with a black edge
  // where it would vanish into the snow.
  const FLAGS = {
    it: ['KKKKKKKKKK', 'GGGWWWRRRK', 'GGGWWWRRRK', 'GGGWWWRRRK', 'GGGWWWRRRK', 'KKKKKKKKKK'],
  };

  // ------------------------------------------------------------ explosion
  // Like snake-bit's: a burst of pieces flung out and pulled down, here
  // scaled to a 224-pixel screen and kept to the VIC palette. Positions
  // are world coordinates, so the pieces stay where the pineapple was.
  const PIECE_COLORS = [VIC.yellow, VIC.yellow, VIC.orange, VIC.green, VIC.red];
  // Burnt on fire, a tree or a fence goes up in its own colours.
  const TREE_PIECES = [VIC.green, VIC.green, VIC.green, VIC.orange];
  const FENCE_PIECES = [VIC.orange, VIC.orange, VIC.red];

  function spawnExplosion(x, y, colors = PIECE_COLORS) {
    // A white flash first, so it reads as a bang over the speckle...
    particles.push({ x, y, vx: 0, vy: 0, life: 0.12, flash: true });
    // ...then chunks: single pixels vanish into the snow at this size.
    for (let k = 0; k < 40; k++) {
      const a = Math.random() * Math.PI * 2;
      const v = 30 + Math.random() * 50;
      particles.push({
        x, y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - 40,
        life: 0.6 + Math.random() * 0.5,
        size: Math.random() < 0.35 ? 3 : 2,
        color: colors[Math.floor(Math.random() * colors.length)],
      });
    }
  }

  // Three stars: a fountain of bright specks in every colour the VIC has.
  const SPARKLE_COLORS = [VIC.yellow, VIC.orange, VIC.red, VIC.green, VIC.lightBlue, VIC.blue, VIC.cyan];
  function spawnSparkles(x, y) {
    for (let k = 0; k < 70; k++) {
      const a = -Math.PI * (0.1 + 0.8 * Math.random());
      const v = 40 + Math.random() * 70;
      particles.push({
        x: x + (Math.random() - 0.5) * 50, y,
        vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        life: 0.8 + Math.random() * 0.9,
        size: Math.random() < 0.3 ? 2 : 1,
        color: SPARKLE_COLORS[Math.floor(Math.random() * SPARKLE_COLORS.length)],
      });
    }
  }

  // Wind lines streaming back uphill off a fast skier: past WIND_AT times
  // normal speed (a long tuck, or a steep pitch), longer the faster. Fire
  // has its own trail, so not then.
  const WIND_AT = 1.45, WIND_FULL = 2.1, WIND_LEN = 24;
  function drawWind(spriteH, camY) {
    const fast = speed / DOWN_SPEED;
    if (state !== 'running' || fast <= WIND_AT || onFire()) return;
    const k = Math.min(1, (fast - WIND_AT) / (WIND_FULL - WIND_AT));
    const len = Math.round(3 + WIND_LEN * k);
    const lean = -vx / Math.max(20, speed);        // straight back along the way you came
    const top = Math.round(skierY) - camY + 5 - spriteH;
    const phase = Math.floor(performance.now() / 45);
    for (const [dx, dy, l] of [[-4, 4, len], [0, 0, len + 3], [4, 4, len - 2]]) {
      for (let r = 1; r <= l; r++) {
        if ((r + phase) % 4 >= 2) continue;       // short dashes, drifting uphill
        // Dark by the skier, fading to light blue further back.
        put(Math.round(skierX + dx + lean * r), top + dy - r, r < l * 0.3 ? VIC.blue : VIC.lightBlue);
      }
    }
  }

  // A short trail of embers left on the slope behind a skier on fire.
  const EMBER_COLORS = [VIC.red, VIC.orange, VIC.yellow];
  const GOD_EMBER_COLORS = [VIC.blue, VIC.lightBlue, VIC.cyan];
  function spawnEmbers() {
    for (let k = 0; k < 3; k++) {
      particles.push({
        x: skierX + (Math.random() - 0.5) * 6, y: skierY - 2 + Math.random() * 4,
        vx: (Math.random() - 0.5) * 8, vy: -4 - Math.random() * 6, g: 0,
        life: 0.16 + Math.random() * 0.16,
        size: Math.random() < 0.2 ? 2 : 1,
        color: (runGod ? GOD_EMBER_COLORS : EMBER_COLORS)[Math.floor(Math.random() * 3)],
      });
    }
  }

  function updateParticles(dt) {
    for (const p of particles) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vy += (p.g === undefined ? 160 : p.g) * dt;
      p.life -= dt;
    }
    particles = particles.filter(p => p.life > 0);
  }

  const fireColors = god => god ? [VIC.blue, VIC.lightBlue, VIC.cyan] : [VIC.red, VIC.orange, VIC.yellow];

  // A flickering tongue of flame up to `max` pixels tall standing on (x, y).
  function flameUp(x, y, god, max) {
    const colors = fireColors(god);
    const h = Math.round(hash(x * 7 + 3, Math.floor(performance.now() / 90)) * max);
    for (let r = 1; r <= h; r++) put(x, y - r, colors[Math.min(2, r - 1)]);
  }

  // A tree on fire: the canopy flickers in the fire's colours with flames
  // above, for POLE_BURN_MS; then a charred black skeleton. A tree that
  // was hit leaves only a stump.
  function drawScorchedTree(tr, sc, camY) {
    const shape = tr.cherry ? CHERRY : tr.rata ? RATA : tr.bush ? BUSH : tr.groundsel ? GROUNDSEL : TREE;
    const x0 = tr.x - 4, y0 = tr.y - camY - (shape.length - 1), base = tr.y - camY;
    if (sc.hit) {
      put(tr.x, base, VIC.black); put(tr.x, base - 1, VIC.black);
      put(tr.x - 1, base, VIC.black); put(tr.x + 1, base, VIC.black);
      return;
    }
    const age = performance.now() - sc.at, frame = Math.floor(performance.now() / 90);
    const colors = fireColors(sc.god);
    for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[r].length; c++) {
        if (shape[r][c] === '.') continue;
        if (age < POLE_BURN_MS) put(x0 + c, y0 + r, colors[Math.floor(hash(c * 31 + r, frame + tr.x) * 3)]);
        else if (shape[r][c] === 'O' || hash(tr.x * 13 + c, tr.y + r) > 0.35) put(x0 + c, y0 + r, VIC.black);
      }
    }
    if (age < POLE_BURN_MS) for (let c = 2; c <= 6; c++) flameUp(x0 + c, y0 + (c === 4 ? 0 : 2), sc.god, 3);
  }

  // One column of a fence that was hit: gone where it was hit, then the
  // fire creeps out from the gap at FENCE_SPREAD px/s, each bit burning
  // for POLE_BURN_MS before it chars.
  const FENCE_SPREAD = 8;
  function fenceState(sc, x) {
    if (x >= sc.gap0 && x <= sc.gap1) return 'gone';
    const lit = sc.at + 1000 * (x < sc.gap0 ? sc.gap0 - x : x - sc.gap1) / FENCE_SPREAD;
    const now = performance.now();
    return now < lit ? 'wood' : now < lit + POLE_BURN_MS ? 'burning' : 'char';
  }

  // A pole clipped on fire: flames along it in that fire's colours,
  // dying down over POLE_BURN_MS, then a little heap of ash.
  const POLE_BURN_MS = 4000;
  function drawBurningPole(p, sy) {
    const d = p.fallen, age = performance.now() - p.burning.at;
    if (age >= POLE_BURN_MS) {
      const cx = p.x + d * 4, cy = sy - 1;
      for (let x = -4; x <= 4; x++) put(cx + x, cy, VIC.black);
      for (let x = -2; x <= 2; x++) put(cx + x, cy - 1, VIC.black);
      put(cx, cy - 2, VIC.black); put(cx - d, cy - 2, VIC.black);
      return;
    }
    const ink = p.red ? VIC.red : VIC.blue;
    for (let k = 0; k < 9; k++) put(p.x + d * k, sy - (k >> 2), ink);
    const colors = p.burning.god ? [VIC.blue, VIC.lightBlue, VIC.cyan] : [VIC.red, VIC.orange, VIC.yellow];
    const frame = Math.floor(performance.now() / 90);
    const left = 1 - age / POLE_BURN_MS;
    for (let k = 0; k < 9; k++) {
      const h = Math.round(hash(k + p.x, frame) * 4 * left);
      for (let r = 1; r <= h; r++) put(p.x + d * k, sy - (k >> 2) - r, colors[Math.min(2, r - 1)]);
    }
  }

  function drawPole(p, sy) {
    if (p.burning) { drawBurningPole(p, sy); return; }
    const ink = p.red ? VIC.red : VIC.blue;
    if (p.fallen) {
      // Knocked flat, lying away from the skis that hit it, flag at the tip.
      const d = p.fallen;
      for (let k = 0; k < 9; k++) put(p.x + d * k, sy - (k >> 2), ink);
      const tx = p.x + d * 8;
      put(tx, sy - 3, ink); put(tx - d, sy - 3, ink); put(tx - d, sy - 4, ink);
      return;
    }
    for (let k = 0; k < 9; k++) put(p.x, sy - 8 + k, ink);
    // A little triangle flag, pointing to the side you pass on.
    const d = p.pass;
    put(p.x + d, sy - 8, ink); put(p.x + 2 * d, sy - 8, ink); put(p.x + 3 * d, sy - 8, ink);
    put(p.x + d, sy - 7, ink); put(p.x + 2 * d, sy - 7, ink);
    put(p.x + d, sy - 6, ink);
  }

  // Dawn: the sun just up on the right, so everything standing throws a
  // long shadow off to the left across the snow. Drawn first, under it all.
  const SHADOW_DX = 1.5, SHADOW_DY = 0.7;
  function shadowOf(rows, x0, top) {
    const base = top + rows.length - 1;
    for (let r = 0; r < rows.length; r++) {
      const h = rows.length - 1 - r;
      for (let c = 0; c < rows[r].length; c++) {
        if (rows[r][c] === '.') continue;
        const sx = x0 + c - Math.round(h * SHADOW_DX), sy = base - Math.round(h * SHADOW_DY);
        put(sx, sy, VIC.lightBlue); put(sx - 1, sy, VIC.lightBlue);
      }
    }
  }
  const POLE_SHAPE = Array(9).fill('X');
  function drawShadows(camY, j0, j1) {
    const { salt, centerAt } = course;
    const iMin = Math.floor(-MARGIN / TREE_CELL), iMax = Math.ceil((W + MARGIN) / TREE_CELL);
    for (let j = j0; j <= j1; j++) {
      for (let i = iMin; i < iMax; i++) {
        const tr = treeAt(i, j, salt, centerAt);
        if (!tr || exploded.has(i + ',' + j) || scorched.has(i + ',' + j)) continue;
        const rows = tr.pine ? PINEAPPLE : tr.pen ? PENITENTE : tr.ice ? ICE_SHAPES[(((tr.i * 7 + tr.j * 3) % 3) + 3) % 3] : tr.rock ? ROCKS[tr.rock - 1] : tr.cherry ? CHERRY : tr.rata ? RATA
          : tr.bush ? BUSH : tr.groundsel ? GROUNDSEL : TREE;
        shadowOf(rows, tr.x - (tr.pine ? 2 : 4), tr.y - camY - rows.length + 1);
      }
    }
    for (const p of course.poles) {
      const sy = p.y - camY;
      if (!p.fallen && !p.burning && sy > -4 && sy < H + 20) shadowOf(POLE_SHAPE, p.x, sy - 8);
    }
    const k0 = Math.floor(camY / FENCE_SLOT) - 1, k1 = Math.floor((camY + H) / FENCE_SLOT) + 1;
    for (let k = k0; k <= k1; k++) {
      for (const side of [-1, 1]) {
        const f = fenceAt(k, side, salt, centerAt);
        if (f && !scorched.has(`f${k},${side}`)) shadowOf(Array(5).fill('X'.repeat(f.x1 - f.x0 + 1)), f.x0, f.y - camY - 4);
      }
    }
    if (state !== 'title' && state !== 'crashed') {
      const s = SPRITES[mode] || SPRITES.down;
      shadowOf(s.map(r => r.replace(/[^.]/g, 'X')), Math.round(skierX) - 3, Math.round(skierY) - camY + 5 - s.length);
    }
    for (const a of animals) shadowOf(['XXXXX', 'XXXXX', 'XXXXX'], Math.round(a.x) - 2, Math.round(a.y) - camY - 2);
  }

  // A row of slope always looks the same, so each one is computed once, on
  // the frame it scrolls into view, and copied after that. Most frames only
  // build a row or two; the noise is the expensive part.
  const snowRows = new Map();
  const titleCenter = () => W / 2;

  function snowRow(wy, centerAt, lineAt) {
    let row = snowRows.get(wy);
    if (row) return row;
    row = new Uint8ClampedArray((W + 2 * MARGIN) * 4);
    const c = centerAt(wy);
    // The worn line stops where an arena's skiers stop.
    const line = lineAt && !(course && course.arena && wy > course.arena.y + course.arena.ry * 0.5 + 4) ? lineAt(wy) : null;
    // Steep pitches look it: the piste's speckle thickens with the slope.
    const steep = course && course.slopeAt ? 0.3 * Math.max(0, course.slopeAt(wy) - 1) : 0;
    const lips = (course && course.lips) || [], borders = (course && course.borders) || [];
    for (let sx = -MARGIN; sx < W + MARGIN; sx++) {
      let col = VIC.white;
      if (sx < 0 || sx >= W) {   // past the edge: forest, densely speckled,
        // and solid at the screen's edges, as the mountain's own edge was
        const rim = Math.min(sx + MARGIN, W + MARGIN - 1 - sx) < EDGE_STRIP;
        if (rim || hash(sx + 9001, wy) < 0.6) col = VIC.lightBlue;
        const i = (sx + MARGIN) * 4;
        row[i] = col[0]; row[i + 1] = col[1]; row[i + 2] = col[2]; row[i + 3] = 255;
        continue;
      }
      const rock = course && course.rockDepth ? course.rockDepth(sx, wy) : -1;
      if (rock > 0) {
        // Rock: dark blue, cracked with black, the odd icy glint.
        const n = noise2(sx / 4, wy / 4) + 0.35 * hash(sx + 71, wy + 3);
        col = n < 0.45 ? VIC.black : n > 1.15 ? VIC.lightBlue : VIC.blue;
        const i = (sx + MARGIN) * 4;
        row[i] = col[0]; row[i + 1] = col[1]; row[i + 2] = col[2]; row[i + 3] = 255;
        continue;
      }
      const depth = snowDepth(sx, c, wy);
      // The worn line: packed snow along the racing line, speckled cyan
      // (the VIC-20 has no grey), densest in the middle of the track.
      const off = line === null ? Infinity : Math.abs(sx - line);
      if (off <= LINE_HW && hash(sx + 977, wy + 31) < (off <= 1 ? 0.5 : 0.25)) col = VIC.cyan;
      else if (depth > 0) {
        // Light blue speckle: light over most of the fresh snow, pushed
        // around by drift noise, and solid only in a thin strip at the
        // margin.
        const drift = (noise2(sx / 13, wy / 13) - 0.5) * 0.5 * (1 - depth);
        // (On a TV with forest past the edges, the strip melts into it.)
        const density = depth > 0.92 ? (MARGIN ? 0.6 : 1) : Math.max(0, 0.7 * depth ** 2 + drift);
        if (hash(sx, wy) < density) col = course && course.shape.icy && hash(sx + 9, wy) < 0.7 ? VIC.cyan : VIC.lightBlue;
      } else if (hash(sx + 4441, wy + 17) < 0.005) {
        col = VIC.lightBlue;   // a stray speck, so the piste isn't spotless
      } else if (hash(sx + 5113, wy + 29) < steep) {
        col = VIC.paleBlue;    // a steep face, faintly shaded
      }
      // The serac: a wall of blue ice just off the piste on one side.
      if (course && course.shape.serac) {
        const sr = course.shape.serac, y0 = sr.from * course.finishY, y1 = sr.to * course.finishY;
        if (wy > y0 - 20 && wy < y1 + 20) {
          const ramp = Math.min(1, (wy - y0 + 20) / 30, (y1 + 20 - wy) / 30);
          const into = sr.side * (sx - c) - (pisteHW(wy) + 4 + 12 * (1 - ramp) + 3 * noise2(wy / 6, 51));
          if (into > 0 && into <= 2) col = VIC.white;
          else if (into > 2) col = hash(sx * 5 + 1, Math.floor(wy / 3)) < 0.1 ? VIC.cyan : into < 8 ? VIC.paleBlue : VIC.lightBlue;
        }
      }
      const ice = course && course.iceDepth ? course.iceDepth(sx, wy) : -99;
      if (ice > -2 && ice <= 0 && course.shape.ice) {
        col = VIC.blue;   // the cliff's shadow on the snow
      } else if (ice > 0) {
        // A glacier's cliff from above: a bright white lip along the face,
        // pale blue ice beyond, the odd cyan crack running back.
        col = ice <= 2 ? VIC.white : hash(sx * 3 + 1, Math.floor(wy / 5)) < 0.08 ? VIC.cyan : VIC.paleBlue;
      } else if (course && course.screeAt && course.screeAt(sx, wy) && (off > LINE_HW || line === null)) {
        // Scree: dark volcanic grit, brown and black; or blue-black rock.
        const v = hash(sx + 5, wy + 11);
        col = course.shape.darkRock ? (v < 0.12 ? VIC.black : v < 0.42 ? VIC.blue : VIC.lightBlue)
          : v < 0.2 ? VIC.black : VIC.orange;
      }
      // The lip where a steep pitch drops away: a broken dark line right
      // across the slope.
      for (const lip of lips) {
        const d = wy - lip - Math.round(1.5 * Math.sin(sx / 7));
        if (d >= 0 && d <= 1 && hash(sx + 313, wy) < 0.8) col = VIC.blue;
      }
      // A border: a dashed red line straight across.
      for (const b of borders) if (wy - b >= 0 && wy - b <= 1 && ((sx + 64) >> 2) % 2) col = VIC.red;
      // Tussock grass: little yellow tufts out in the fresh snow.
      if (course && course.shape.tussock && depth > 0.15) {
        const cx = Math.floor(sx / 7), cy = Math.floor(wy / 7);
        if (hash(cx * 31 + 7, cy + 401) < 0.22) {
          const ch = (TUFT[wy - cy * 7 - 2] || '')[sx - cx * 7 - 1];
          if (ch === 'Y') col = VIC.yellow; else if (ch === 'O') col = VIC.orange;
        }
      }
      if (col === VIC.white && course && course.shape.dawn) col = VIC.dawn;
      const i = (sx + MARGIN) * 4;
      row[i] = col[0]; row[i + 1] = col[1]; row[i + 2] = col[2]; row[i + 3] = 255;
    }
    snowRows.set(wy, row);
    if (snowRows.size > H * 3) {
      for (const k of snowRows.keys()) if (Math.abs(k - wy) > H * 2) snowRows.delete(k);
    }
    return row;
  }

  function render() {
    // Between Championship courses, the world map instead of the slope.
    const onMap = !!champ && (champ.stage === 'pick' || champ.stage === 'fly') && !overlayEl.hidden;
    if (showMap(onMap)) { drawMap(true); mapCtx.putImageData(mapImg, 0, 0); }
    if (onMap) {
      if (!MAP_WIDE) { drawMap(); ctx.putImageData(img, 0, 0); }
      if (champ.stage === 'fly' && performance.now() - champ.fly.at >= flightTime()) champGo();   // touchdown
      return;
    }
    // An avalanche shakes the whole mountain.
    const shake = slideLevel() > 0 ? Math.round((Math.random() - 0.5) * 2.4 * slideLevel()) : 0;
    const camY = cameraTop() + shake;
    camX = cameraLeft(camY);
    const centerAt = course ? course.centerAt : titleCenter;

    const lineAt = course ? course.lineAt : null;
    for (let sy = 0; sy < H; sy++) {
      img.data.set(snowRow(camY + sy, centerAt, lineAt).subarray((camX + MARGIN) * 4, (camX + MARGIN + VW) * 4), sy * VW * 4);
    }

    // Trees, scattered off the piste and thickening toward the edges.
    const salt = course ? course.salt : 0;
    const j0 = Math.floor(camY / TREE_CELL) - 1;
    const j1 = Math.floor((camY + H) / TREE_CELL) + 1;
    if (course && course.shape.dawn) drawShadows(camY, j0, j1);
    const iMin = Math.floor(-MARGIN / TREE_CELL), iMax = Math.ceil((W + MARGIN) / TREE_CELL);
    for (let j = j0; j <= j1; j++) {
      for (let i = iMin; i < iMax; i++) {
        const tr = treeAt(i, j, salt, centerAt);
        if (!tr) continue;
        const sc = scorched.get(i + ',' + j);
        if (sc) drawScorchedTree(tr, sc, camY);
        else if (exploded.has(i + ',' + j)) continue;
        else if (tr.pen) blit(PENITENTE, tr.x - 4, tr.y - camY - PENITENTE.length + 1);
        else if (tr.ice) { const r = ICE_SHAPES[(((tr.i * 7 + tr.j * 3) % 3) + 3) % 3]; blit(r, tr.x - 4, tr.y - camY - r.length + 1); }
        else if (tr.rock) { const r = ROCKS[tr.rock - 1]; blit(r, tr.x - 4, tr.y - camY - r.length + 1); }
        else if (tr.cherry) blit(CHERRY, tr.x - 4, tr.y - camY - 8);
        else if (tr.rata) blit(RATA, tr.x - 4, tr.y - camY - 8);
        else if (tr.bush) blit(BUSH, tr.x - 4, tr.y - camY - 4);
        else if (tr.groundsel) blit(GROUNDSEL, tr.x - 4, tr.y - camY - GROUNDSEL.length + 1);
        else if (!tr.pine) blit(TREE, tr.x - 4, tr.y - camY - 8, VIC.green);
        else blit(PINEAPPLE, tr.x - 2, tr.y - camY - 6);
      }
    }

    if (course && !exploded.has('t,t')) {
      blit(PINEAPPLE, course.titlePine.x - 2, course.titlePine.y - camY - 6);
    }

    // Fences: a post every third pixel, two rails between.
    const k0 = Math.floor(camY / FENCE_SLOT) - 1, k1 = Math.floor((camY + H) / FENCE_SLOT) + 1;
    for (let k = k0; k <= k1; k++) {
      for (const side of [-1, 1]) {
        const f = fenceAt(k, side, salt, centerAt);
        if (!f) continue;
        const sc = scorched.get(`f${k},${side}`);
        const sy = f.y - camY;
        if (course && course.shape.crevasses) {
          // A crevasse: a jagged black crack, blue at its lips.
          for (let x = f.x0; x <= f.x1; x++) {
            const yo = Math.round(1.5 * Math.sin(x * 0.7 + k)) + (hash(x, k) < 0.3 ? 1 : 0);
            put(x, sy - 3 + yo, VIC.blue); put(x, sy - 2 + yo, VIC.black); put(x, sy - 1 + yo, VIC.black); put(x, sy + yo, VIC.blue);
          }
          continue;
        }
        for (let x = f.x0; x <= f.x1; x++) {
          const state = sc ? fenceState(sc, x) : 'wood';
          if (state === 'gone') continue;
          const ink = state === 'wood' ? VIC.orange : state === 'char' ? VIC.black
            : fireColors(sc.god)[Math.floor(hash(x, Math.floor(performance.now() / 90)) * 3)];
          put(x, sy - 3, ink);
          put(x, sy - 1, ink);
          if ((x - f.x0) % 3 === 0) { put(x, sy - 4, ink); put(x, sy - 2, ink); put(x, sy, ink); }
          if (state === 'burning') flameUp(x, sy - 4, sc.god, 3);
        }
      }
    }

    if (course && course.nets && course.nets.length) drawEdgeNets(camY);
    if (course) for (const g of course.signs) drawSign(g, camY);
    if (course && course.camp) drawCamp(course.camp, camY);
    if (course && course.fans) drawFans(camY);
    if (sluff && course && course.couloir) drawSluff(camY);

    if (course) {
      for (const p of course.poles) {
        const sy = p.y - camY;
        if (sy > -4 && sy < H + 10) drawPole(p, sy);
      }
      // Finish line: red/black checker across the piste.
      const fy = course.finishY - camY;
      if (fy > -4 && fy < H + 4) {
        const c = centerAt(course.finishY), hw = pisteHW(course.finishY);
        for (let x = Math.floor(c - hw); x <= c + hw; x++) {
          for (let k = 0; k < 4; k++) {
            put(x, fy + k, ((x >> 1) + (k >> 1)) % 2 ? VIC.red : VIC.black);
          }
        }
      }
      if (slide && slide.y !== null) drawAvalanche(camY);   // over the poles it buries
      if (snowballs.length) drawSnowballs(camY);
      if (icefall.length) drawIcefall(camY);
      if (state !== 'title') {
        drawAnimals(camY);
        const s = SPRITES[mode] || SPRITES.down;
        drawWind(s.length, camY);
        // Sprites differ in height; they all stand on the same row.
        if (!fellIn) blit(s, Math.round(skierX) - 3, Math.round(skierY) - camY + 5 - s.length, VIC.black);
        if (onFire() && state !== 'crashed') {
          const frames = runGod ? GOD_FLAMES : FLAMES;
          const fl = frames[Math.floor(performance.now() / 90) % frames.length];
          blit(fl, Math.round(skierX) - 3, Math.round(skierY) - camY + 5 - s.length - 3);
        }
      }
      if (course.liftX !== null) drawLift(camY);
      if (heli) drawHeli(camY);
      for (const p of particles) {
        const px = Math.round(p.x), py = Math.round(p.y - camY);
        if (p.flash) {
          for (let dy = -6; dy <= 6; dy++)
            for (let dx = -6; dx <= 6; dx++)
              if (dx * dx + dy * dy <= 36) put(px + dx, py + dy, dx * dx + dy * dy <= 12 ? VIC.yellow : VIC.white);
          continue;
        }
        for (let dy = 0; dy < p.size; dy++)
          for (let dx = 0; dx < p.size; dx++) put(px + dx, py + dy, p.color);
      }
    }

    if (course && state !== 'title') { drawPetals(); drawStreaks(); drawMoths(); drawBirds(); }
    // Night falls on the slope, not on the score: stars go on after.
    if (course && course.shape.night && state !== 'title') nightfall(camY);
    if (tally && tally.dinged) drawStars(tally.starsShown);

    ctx.putImageData(img, 0, 0);
  }

  // Three star slots under the bonus; earned ones gold with an orange rim,
  // the rest outlines in light blue.
  const STAR = [
    '....X....',
    '...XXX...',
    '...XXX...',
    'XXXXXXXXX',
    '.XXXXXXX.',
    '..XXXXX..',
    '..XXXXX..',
    '.XXX.XXX.',
    '.XX...XX.',
  ];
  const STAR_ROW = 76;         // screen row of the stars' centres
  function drawStars(n) {
    for (let k = 0; k < 3; k++) {
      const x0 = camX + VW / 2 - 4 + (k - 1) * 16, y0 = STAR_ROW - 4;
      if (k < n) {
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) blit(STAR, x0 + dx, y0 + dy, VIC.orange);
        blit(STAR, x0, y0, VIC.yellow);
      } else {
        blit(STAR, x0, y0, VIC.lightBlue);
      }
    }
  }
  // The same stars on the score card, on a canvas of their own.
  function paintCardStars(n) {
    const sctx = finalStarsEl.getContext('2d');
    sctx.clearRect(0, 0, finalStarsEl.width, finalStarsEl.height);
    const stamp = (x0, y0, ink) => {
      sctx.fillStyle = css(ink);
      STAR.forEach((row, y) => [...row].forEach((ch, x) => { if (ch === 'X') sctx.fillRect(x0 + x, y0 + y, 1, 1); }));
    };
    for (let k = 0; k < 3; k++) {
      const x0 = 1 + k * 14, y0 = 1;
      if (k < n) {
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) stamp(x0 + dx, y0 + dy, VIC.orange);
        stamp(x0, y0, VIC.yellow);
      } else {
        stamp(x0, y0, VIC.lightBlue);
      }
    }
  }

  // ------------------------------------------------------------------ hud
  let flashUntil = 0;
  function flash(text, ms = 1100) {
    msgEl.textContent = text;
    flashUntil = performance.now() + ms;
  }

  // The same for what the skier just did: beside the skier, on whichever
  // side has more room and well clear of the poles. It rides along with
  // the skier for POP_STAY, then is left behind: it drifts up the screen at
  // POP_DRIFT of the slope's speed, only half following, and blinks out at
  // POP_MS.
  const POP_MS = 1700, POP_STAY = 450, POP_GAP = 18, POP_DRIFT = 0.7, POP_FOLLOW = 0.5, POP_BLINK = 350;
  const popEl = document.getElementById('pop');
  let popUntil = 0, popFrom = { x: 0, side: 1 };
  function pop(text) {
    popEl.textContent = text;
    popEl.hidden = false;
    popUntil = performance.now() + POP_MS;
    popFrom = { x: skierX - camX, side: skierX - camX < VW / 2 ? 1 : -1 };
    placePop();
  }
  function placePop() {
    const left = Math.max(0, popUntil - performance.now()), age = POP_MS - left;
    const behind = Math.max(0, age - POP_STAY) / 1000;   // seconds since it let go
    if (!behind) popFrom.x = skierX - camX;   // still riding along
    const tvW = popEl.parentElement.clientWidth, w = popEl.offsetWidth, scale = tvW / VW;
    const sx = popFrom.x + (skierX - camX - popFrom.x) * POP_FOLLOW;
    const x = (sx + popFrom.side * POP_GAP) * scale;
    popEl.style.left = (popFrom.side > 0 ? Math.min(x, tvW - w - 4) : Math.max(x, w + 4)) + 'px';
    popEl.style.transform = popFrom.side > 0 ? 'none' : 'translateX(-100%)';
    popEl.style.top = ((SKIER_Y - 4 - speed * POP_DRIFT * behind) / H * 100) + '%';
    popEl.style.visibility = left < POP_BLINK && Math.floor(left / 75) % 2 ? 'hidden' : 'visible';
  }

  // Each mode keeps its own BEST; the box shows the highlighted mode's on
  // the title and the run's during it.
  const BEST_KEYS = { single: 'slalom_best', endless: 'slalom_best_endless', championship: 'slalom_best_championship' };
  const best = {};
  for (const m in BEST_KEYS) {
    best[m] = 0;
    try { best[m] = parseInt(localStorage.getItem(BEST_KEYS[m]) || '0', 10) || 0; } catch (_) {}
  }
  // The Championship's best is a total, set when one ends; its courses
  // leave the others alone.
  // A mountain's course in Single keeps its own best too: 'single:<id>'.
  const bestMode = () => state === 'title' && !champ
    ? (chosenMode() === 'endless' ? 'endless' : chosenMode() === 'championship' ? 'championship' : classicPick() ? 'single:' + classicPick() : 'single')
    : champ ? 'championship' : course && course.endless ? 'endless' : runClassic ? 'single:' + runClassic : 'single';
  const bestKey = m => BEST_KEYS[m] || 'slalom_best_' + m.replace(':', '_');
  function getBest(m) {
    if (!(m in best)) { best[m] = 0; try { best[m] = parseInt(localStorage.getItem(bestKey(m)) || '0', 10) || 0; } catch (_) {} }
    return best[m];
  }

  function paintHud() {
    const score = state === 'title' ? 0 : earned() + shownBonus;
    scoreEl.textContent = score;
    // Endless counts down what's left instead of up what's gone.
    const endless = bestMode() === 'endless', left = ENDLESS_MISSES - (missed || 0);
    missLabelEl.textContent = endless ? 'LEFT' : 'MISS';
    missEl.textContent = endless ? left : missed || 0;
    missBoxEl.classList.toggle('last-miss', endless && left === 1 && state !== 'title' && state !== 'crashed');
    // Like snake-bit, BEST climbs live once this run passes it.
    const m = bestMode();
    if (score > getBest(m) && m !== 'championship') {
      best[m] = score;
      try { localStorage.setItem(bestKey(m), score); } catch (_) {}
    }
    // Your best on the course you're skiing; nothing until you're on one.
    bestEl.textContent = state === 'title' ? '-' : getBest(m);
    placeHudButtons();
  }

  // ------------------------------------------------------------ championship
  // Ten courses out of these fourteen, lowest to highest. Two are open at
  // the start; finishing a course opens all of its `unlocks`, a crash only
  // the first. Each can be skied once per Championship, and Chomolungma
  // opens only after nine. `lon` orders the choices west to east, as they
  // sit on the map. Seeds are placeholders until the courses are tuned.
  const MOUNTAINS = [
    { id: 'alyeska', name: 'ALYESKA', country: 'ALASKA, USA', height: '1,200 M', lon: -149.1, seed: 1101,
      unlocks: ['aoraki', 'pista3'],
      fact: 'Its name is the Aleut word that gave Alaska its name: Alaxsxaq, "the mainland". Its North Face claims to be North America\'s longest double-black-diamond run, a rating that means experts only: steep, ungroomed slopes, narrow chutes, rocks and cliffs, and no easy way out once you\'re in.' },
    { id: 'kunama', name: 'KUNAMA NAMADGI (KOSCIUSZKO)', country: 'AUSTRALIA', height: '2,228 M', lon: 148.3, seed: 1202,
      unlocks: ['aoraki', 'fuji'],
      fact: 'Every summer for thousands of years, Aboriginal clans met on these peaks to trade, hold initiations and feast on Bogong moths. In 1840 two Aboriginal guides, Charley Tarra and Jackey, led a Polish explorer up here, and Tarra\'s hunting kept the party from starving. The explorer "named" it. A dual Aboriginal name, Kunama Namadgi ("snow mountain"), was proposed in 2019 and is still debated.' },
    { id: 'pista3', name: 'PISTA 3 "FRANCO BERTHOD"', country: 'LA THUILE, ITALY', height: '~2,500 M', lon: 6.95, seed: 1303,
      unlocks: ['cervino'],
      fact: 'Italy\'s steepest piste: 76% at the Grand Muret, right after the start. The women\'s World Cup races here, on north-facing, rock-hard snow. It\'s dangerous for anyone but experts.' },
    { id: 'aoraki', name: 'AORAKI', country: 'NEW ZEALAND', height: '3,724 M', lon: 170.1, seed: 1404,
      unlocks: ['vinson', 'fuji'],
      fact: 'To the Ngai Tahu, the Maori iwi of most of the South Island, Aoraki is an ancestor: he and his brothers were turned to stone on their stranded canoe, which became the South Island. The mountain was returned to Ngai Tahu in 1998, and they gifted it back to the nation. In 1991 a rock avalanche sheared 10 m off its summit, and by 2013 it had shrunk 30 m in all.' },
    { id: 'fuji', name: 'FUJI', country: 'JAPAN', height: '3,776 M', lon: 138.7, seed: 1505,
      unlocks: ['annapurna', 'kirinyaga'],
      fact: 'Fuji last erupted in 1707, and its ash fell on Edo, today\'s Tokyo, almost 100 km away. The mountain is sacred: from the 8th station up it belongs to a Shinto shrine, and women weren\'t allowed to climb it until 1872.' },
    { id: 'cervino', name: 'CERVINO (MATTERHORN)', country: 'SWITZERLAND - ITALY', height: '4,478 M', lon: 7.66, seed: 1606,
      unlocks: ['kirinyaga', 'kilimanjaro'],
      fact: 'Valley legends told of spirits and a ruined city on its summit. Local guide Jean-Antoine Carrel tried for years from Italy, but in 1865 a British-led party from Zermatt beat him to the top, and four of its seven men died coming down. Carrel summited three days later. Below it you can ski from Switzerland into Italy, 20 km in one run. Its steep east side was first skied only in 1975, by Toni Valeruz. Few have dared since.' },
    { id: 'vinson', name: 'VINSON', country: 'ANTARCTICA', height: '4,892 M', lon: -85.6, seed: 1707,
      unlocks: ['aconcagua'],
      fact: 'No one saw it until 1958, from a US Navy plane, and the Americans named it after one of their congressmen. Chile counts it as part of its own Antarctic territory, but under the 1959 treaty no country\'s claim is recognised: Antarctica is kept for peace and science. Only about 150 climbers a season reach the top, with nights down to -40 C.' },
    { id: 'kirinyaga', name: 'KIRINYAGA (MOUNT KENYA)', country: 'KENYA', height: '5,199 M', lon: 37.3, seed: 1808,
      unlocks: ['kilimanjaro'],
      fact: 'To the Kikuyu people, Kirinyaga is home to the god Ngai, so they traditionally built their houses with the door facing the mountain. The country\'s name, Kenya, comes from how the British heard "Kirinyaga". Its summits honour the Maasai leader Mbatian, his brother and his son. Its glaciers, 16 km from the equator, may be gone by 2030.' },
    { id: 'iztactepetl', name: 'IZTACTEPETL (PICO DE ORIZABA)', country: 'MEXICO', height: '5,636 M', lon: -97.3, seed: 1909, venus: true,
      unlocks: ['aconcagua'],
      fact: 'Locals call it Iztactepetl, the White Mountain. Legend says Quetzalcoatl, the Feathered Serpent god worshipped by the Toltecs and Aztecs, bade farewell to his followers within sight of it, and that Venus, the morning star he became, can be seen settling into its crater. It is Mexico\'s highest peak and a dormant volcano: it last erupted in 1846...' },
    { id: 'kilimanjaro', name: 'KILIMANJARO', country: 'TANZANIA', height: '5,895 M', lon: 37.4, seed: 2010,
      unlocks: ['iztactepetl', 'aconcagua'],
      fact: 'The first recorded summit, in 1889, is credited to some German guy, but he was guided by Yohani Kinyala Lauwo, a young Chagga man who later said he had already climbed it many times. Most climbers take 5 to 8 days to summit. Tanzanian Simon Mtuy ran up and back down in 9 hours 19 minutes, a Guinness World Record.' },
    { id: 'aconcagua', name: 'ACONCAGUA', country: 'ARGENTINA', height: '6,961 M', lon: -70.0, seed: 2111,
      unlocks: ['annapurna', 'k2'],
      fact: 'The highest peak outside Asia, and stray dogs climb it. Several have tagged along with expeditions all the way to the summit, one napped on top before heading down, and climbers still argue over which dog got there first.' },
    { id: 'annapurna', name: 'ANNAPURNA', country: 'NEPAL', height: '8,091 M', lon: 83.8, seed: 2212,
      unlocks: ['k2'],
      fact: 'Its name means "full of food", after the Hindu goddess of nourishment. For decades it was the deadliest of the world\'s 8,000 m peaks: by 2010, one climber had died for every three who reached the top.' },
    { id: 'k2', name: 'K2', country: 'PAKISTAN', height: '8,611 M', lon: 76.5, seed: 2313,
      unlocks: [],
      fact: 'The 1954 first recorded ascent made two Italians national heroes. Amir Mehdi, a porter from Hunza, had carried their oxygen high up the mountain, then was forced to spend the night at about 8,100 m in a snow hole with no tent or sleeping bag. He lost all his toes, and his story was buried for decades.' },
    { id: 'chomolungma', name: 'CHOMOLUNGMA (EVEREST NORTH FACE)', short: 'CHOMOLUNGMA (EVEREST NORTH FACE)', list: 'CHOMOLUNGMA (EVEREST)', country: 'TIBET - CHINA (CONTESTED TERRITORY)', height: '8,849 M', lon: 86.9, seed: 2414,
      unlocks: [],
      fact: 'Named in 1865 after George Everest, a British surveyor who probably never saw it and objected to the honour. Only a handful have ever ridden down this face: in 2001 Marco Siffredi, 22, snowboarded the Norton Couloir from the summit, then vanished trying the Hornbein Couloir a year later. In 2025 Jim Morrison finally skied down that line, as you are about to.' },
  ];
  const CHAMP_COURSES = 10, FINALE = 'chomolungma';

  // ------------------------------------------------------------------- map
  // The world between courses, Street Fighter 2 style: land from Natural
  // Earth (public domain, 1:110m), in the Equal Earth projection, baked to
  // a 1-bit bitmap. Runs of sea and land alternate, starting
  // with sea, in base 36.
  const WORLD = {
    big: { w: 220, h: 107, runs: '2o.4.57.1.2.3.1.2.1.4.2.j.c.4.u.2.3q.4.2.1.1.1.1.5.8.f.u.2.b.a.9.4.33.8.2.3.2.3.1.1.9.c.v.1.6.1.1.1.2.j.4.3.2l.9.4.1.5.7.1.3.3.7.5.d.i.5.f.2.1.z.5.1.1z.2.5.z.2.1.1.4.4.9.k.b.2.1.1.a.1.19.1t.3.2.z.6.3.6.6.7.4.b.4.2.4.2.1p.1u.1.3.w.8.3.6.5.m.5.1.1x.1u.x.7.3.a.3.l.6.2.1p.1.7.1u.4.1.1.4.l.8.4.y.7.4.1m.3.2.1y.1.a.j.8.7.q.1.7.3.3.1j.8.2.1v.1.d.l.5.8.q.2.5.1.1.1.3.1k.8.3.28.n.1.b.o.1.1.2.4.1.3.1.1.1k.a.2.26.o.1.c.m.2.1.3.1.1x.6.1.26.z.r.20.1.1.2c.u.5.1.s.1z.1.1.2b.s.1.2.3.3.p.21.2d.v.1.1.u.j.2.6.2.18.2b.u.1.2.v.7.2.8.1.8.2.19.2.1.27.t.10.5.1.2.1.7.6.4.2.18.4.2.25.s.x.7.4.2.2.5.7.4.2.16.6.1.24.s.y.5.4.1.3.5.1.1.1.b.2.10.1.4.5.1.25.q.10.5.b.2.1.d.2.10.1.1.1.1.7.1.24.q.10.5.7.1.4.1.2.c.2.10.4.2.5.1.24.p.12.1.4.5.6.1.3.1.1.1.1.1b.3.2.3.3.23.p.13.1.1.7.7.2.3.1.1.1a.4.2.2.4.24.m.14.a.e.1c.6.2.26.l.14.d.4.1.7.1c.5.1.28.1.1.i.14.f.2.5.1.1.1.1e.2d.1.1.d.2.3.15.w.2.15.2c.1.1.9.7.2.14.y.1.15.2c.1.1.8.8.2.12.r.2.8.2.13.2e.7.9.1.13.s.1.8.4.11.2c.1.2.6.b.1.10.t.2.8.2.1.6.u.2e.1.1.6.1c.u.2.c.5.t.2h.4.8.1.1.2.10.w.1.c.6.c.1.d.1o.1.u.4.5.2.5.1.z.w.1.c.8.9.3.8.1s.1.t.6.3.2.8.2.w.w.2.a.9.8.5.7.2.1.2k.9.6.1.2.3.1.1.t.x.2.9.a.6.6.7.2p.7.17.x.2.8.b.5.8.7.8.1.2h.1.1.3.1.1.15.y.2.5.d.4.b.6.7.1.2j.6.13.10.1.4.f.3.b.7.6.1.2l.4.14.z.1.2.h.3.b.7.8.1.2l.1.7.1.x.10.j.3.e.4.9.1.2k.1.6.4.w.z.3.2.f.2.f.3.9.1.2l.1.4.2.1.6.t.13.f.2.g.1.9.1.2m.2.1.c.s.13.t.1.f.1.2o.b.s.12.j.1.o.1.1.1.2o.c.s.8.2.r.v.1.9.1.4.1.2o.f.q.2.7.q.t.2.1.2.7.2.2t.g.11.n.u.1.2.1.6.3.2s.h.11.m.w.1.1.1.5.4.2s.h.11.l.x.3.4.5.6.1.2k.i.11.k.z.2.4.5.2r.l.x.l.z.3.3.4.2.2.5.2.2h.n.w.j.11.3.2.4.2.1.9.3.2d.p.v.h.12.3.5.1.3.1.2.1.3.7.2a.r.u.h.13.2.i.6.3.1.26.s.t.g.15.1.i.6.1.1.2.1.24.s.t.g.15.4.f.6.2a.r.t.g.19.1.1.1.1.2.1.1.8.2.2.1.2a.q.u.g.1c.1.2.1.d.2.6.1.23.p.u.h.44.o.v.g.1k.3.3.1.2f.n.v.g.5.1.1d.3.3.2.2f.n.u.i.4.1.19.2.1.3.4.2.2g.m.u.h.3.3.19.7.3.2.2i.k.u.g.3.4.17.a.1.3.2j.i.v.f.4.3.18.e.2j.i.w.d.5.3.17.g.2j.h.w.d.5.3.14.j.9.1.29.h.w.d.5.2.13.l.a.1.28.f.y.d.5.2.13.m.2i.d.11.b.6.2.12.n.2i.d.11.a.1b.n.2i.d.11.a.1b.n.2i.d.11.a.1b.m.2j.c.13.8.1c.m.2j.c.13.7.1d.l.2l.a.14.6.1d.6.5.a.2m.a.14.4.1f.4.7.9.2n.8.31.7.c.1.2b.9.30.6.d.1.2b.8.31.2.1.1.f.2.2a.6.3l.1.2c.6.3k.1.2d.5.35.1.c.2.2g.5.3g.1.2i.4.3e.3.2j.4.3e.1.2l.5.60.4.1x.1.43.3.62.1.64.3.10s.1.62.1.1c.6.1.1.7.r.3k.1.1.2.x.1.5.g.2.z.35.2.c.2.k.22.2n.v.i.20.2l.1.2.t.b.2.3.26.2r.3b.1c' },
    // The desktop's map, filling the window: enough pixels for Italy's boot.
    huge: { w: 520, h: 253, runs: 'jo.h.e.n.cl.5.2.2.2.c.3.18.z.1.l.3.11.5.98.1.6.3.2.2.2.6.1.a.5.19.s.8.21.4.8s.3.q.7.a.1a.u.3.25.3.8s.5.2.3.3.5.4.3.s.11.20.6.q.j.m.5.7u.2.k.8.n.z.1y.3.q.m.8b.8.9.2.3.4.1.4.3.2.2.7.k.w.20.3.m.11.4.4.c.3.7c.5.1.a.1.2.4.4.2.1.4.e.j.u.21.3.d.4.4.3.1.19.b.9.5n.2.k.2.u.2.4.d.8.3.4.h.i.q.1.3.1b.2.o.3.a.5.1.1j.2.j.q.1.57.j.c.1.1.2.a.f.5.4.6.6.1.b.c.w.16.a.10.5.1.2d.a.1.5a.q.1.i.4.7.2.3.3.3.2.3.1.1.3.5.4.9.g.p.17.j.o.5.3.4.1.2m.2.9.4i.3.b.1f.7.3.1.1.4.b.2.4.5.2.2.6.e.l.1b.p.4.2.5.m.2.2x.4e.5.c.2b.4.1.3.a.a.k.1c.s.2.2.3.o.2.2z.4a.a.5.2.2.25.c.7.1.5.8.j.c.2.2.1.2.2.s.m.3.3.1.2.1.3v.4a.4.6.2a.1.1.a.8.3.2.b.d.i.9.q.a.4.a.5.40.4a.2.7.1.1.1.1.25.1.5.4.3.1.9.e.c.j.8.q.b.3.b.2.43.4m.22.4.3.2.2.9.7.e.b.m.2.s.c.2.4k.4f.25.9.1.c.4.i.8.1g.c.3.4o.49.26.d.1.2.6.o.8.1e.e.4.47.1.c.4b.25.h.7.o.7.1f.e.4.41.4.2.2.a.4b.e.1.3.3.1k.i.9.q.2.1h.e.4.4.3.3t.8.6.2.1.4e.9.2.2.b.1e.i.9.4.2.24.e.b.3u.6.4.4j.1.1.7.h.1d.h.a.3.3.24.4.2.7.7.3m.b.1.8.3.4m.4.m.1a.h.h.1r.2.h.6.8.3l.k.4.4j.2.2.3.l.1a.h.h.1q.5.d.1.1.5.6.2.1.3l.j.7.4f.2.s.1e.d.h.1q.4.c.3.2.4.6.3n.k.8.4a.3.u.1g.b.i.1r.4.b.2.2.3.8.3n.l.7.47.2.z.1j.5.l.1q.4.c.1.2.1.a.3n.m.7.43.1.12.1k.3.p.1k.3.3.3.b.2.7.2.2.3q.l.6.52.2.2.1j.4.p.1j.4.4.3.a.48.i.5.51.1.3.1j.4.q.1i.4.2.5.5.4h.f.4.51.1.3.1j.3.r.1i.3.3.7.3.4i.f.3.55.1j.2.r.1j.1.4.7.4.4j.g.1.54.2a.2.1.1p.6.1.4k.2.2.5i.2.1.26.3.1.1p.2.6.4l.2.2.5h.20.3.2.6.3.1u.4o.2.2.5h.2.1.1u.2.2.8.6.1q.4q.2.2.1.1.5g.1.1.1s.2.4.7.7.1n.4u.2.1.5h.2.1.1r.1.5.7.8.1n.4u.3.1.5g.1t.1.6.b.1.1.2.1p.1e.1.3d.4.2.5d.22.3.1.20.14.1.4.3.f.4.2w.5.2.5c.22.2.2.21.12.4.2.4.d.5.2w.5i.1z.2.4.22.h.2.k.3.i.5.2y.6.1.5a.1y.2.3.25.h.4.h.5.2.4.b.6.2x.7.2.57.1x.4.1.27.c.2.4.3.h.d.a.4.2y.7.5.53.1w.25.k.4.4.4.e.f.a.4.2x.8.5.51.1w.25.g.7.1.1.5.4.d.h.8.6.2r.b.5.52.1w.26.f.7.1.2.5.5.b.i.8.5.2q.d.1.2.1.52.1w.26.e.8.1.4.4.5.b.5.5.7.9.6.2o.5i.1s.1.1.29.c.a.1.6.4.3.a.2.q.7.2n.d.2.51.1s.2c.b.b.2.6.2.1.1.2.6.2.1.1.t.3.2f.2.9.e.2.50.1s.2b.c.b.1.8.1.5.3.5.t.5.2d.3.2.2.4.g.2.4z.1q.2d.c.b.1.9.1.4.4.4.t.6.2b.4.1.4.3.g.3.4y.1o.1.1.2d.c.k.1.6.3.4.t.7.2a.a.4.e.3.4y.1o.2g.a.h.5.6.4.3.u.6.2b.9.5.d.3.4y.1o.2g.9.j.3.8.2.5.u.5.2d.1.3.5.4.c.3.4y.1o.2j.5.a.6.6.1.8.2.6.v.2.2i.6.4.9.6.4x.1o.2j.1.8.d.p.1.2.3.2.33.7.4.9.6.4x.1o.2j.1.5.g.x.32.9.4.6.1.1.7.4w.1n.2k.m.i.3.8.2.2.32.a.3.4.b.4w.1l.2l.n.x.33.9.1.6.7.52.1i.2l.o.x.35.d.2.1.5.53.1f.2m.q.w.35.c.3.1.1.1.1.55.1e.2m.u.t.36.c.3.58.1c.2n.x.7.4.g.37.c.2.57.1c.2o.y.6.7.c.39.c.1.58.2.2.17.2o.z.5.b.2.4.2.3a.b.1.58.1.3.16.2p.12.1.3t.5l.1.3.v.5.2.1.3.2p.27.2.2o.5k.2.2.o.4.3.8.3.2o.27.3.2p.5j.2.2.n.h.2.2n.1n.1.l.3.2p.5j.1.2.l.i.3.2m.2a.4.2o.5i.2.3.i.k.3.2k.1r.1.1.1.i.4.2n.5i.3.3.i.k.3.2k.1s.3.j.4.2l.5k.2.2.i.k.3.2.1.2g.1t.4.j.5.2.2.2f.5k.2.3.g.m.2.2i.1v.3.j.8.1.1.2e.5l.1.3.g.m.2.2i.1v.4.i.1.1.9.2c.5l.2.4.f.q.1.2f.1w.3.k.5.2.e.20.3.1.5h.2.4.e.r.1.2e.1y.3.j.4.3.f.1z.3.1.5i.2.4.d.r.1.2d.1z.4.q.e.1y.4.1.5j.1.4.c.36.1z.5.s.d.1v.5.1.5j.1.4.c.k.5.2g.21.4.s.e.1t.6.1.5p.b.j.1.2.5.2e.22.3.t.e.t.2.u.5z.b.i.1.5.4.2c.23.3.t.e.r.4.t.3y.1.21.b.b.4.b.3.2b.24.3.s.f.o.7.l.3.2.42.1.1y.c.a.4.d.3.2a.24.3.r.h.1.2.k.7.l.4.1.61.c.9.5.e.4.29.23.4.p.l.j.9.j.48.1.1y.d.8.4.k.4.24.23.5.o.l.i.b.i.4.3.41.1.1z.c.7.5.l.5.22.23.6.n.l.h.d.h.4.2.63.c.4.7.l.6.21.24.5.m.n.g.d.h.4.2.64.l.e.2.3.1.2.2.5.2.1y.25.5.l.n.f.f.h.k.2.5p.i.2u.26.4.j.p.e.g.i.j.3.5p.h.2u.26.5.i.q.c.i.h.j.3.5r.f.2u.26.5.f.t.c.i.3.1.e.i.3.5s.4.1.8.2v.27.5.d.u.b.j.2.2.g.g.3.5z.d.2n.28.5.d.v.9.p.f.g.3.5z.e.2m.29.4.b.x.9.p.g.g.2.60.d.2l.2c.2.9.10.8.p.g.g.2.61.b.2n.2b.2.7.12.8.q.g.g.4.61.8.2n.2c.2.5.14.7.q.g.g.1.2.2.62.6.2n.2d.1.2.17.8.q.2.1.c.g.1.3.1.63.5.g.1.26.2e.19.7.r.2.3.a.m.1.61.4.g.2.27.2d.a.1.z.6.r.2.4.9.m.2.61.3.f.2.2.3.24.2c.7.4.z.6.r.2.4.9.j.1.2.2.61.3.c.5.1.4.a.1.1u.2c.4.6.10.5.r.1.6.7.k.3.63.4.b.5.1.8.2.2.2.1.1u.2m.10.5.r.1.8.4.g.1.5.2.65.2.a.6.1.e.1w.2l.10.4.s.1.9.2.h.1.5.1.67.2.3.3.3.6.1.f.1w.2k.11.4.1.1.p.1.8.2.h.1.6.1.3.1.63.6.1.2.1.n.1w.2j.12.2.3.2.o.3.z.2.65.2.4.q.1v.2j.13.1.3.2.o.3.w.6.65.2.2.s.1u.2j.17.3.p.1.w.6.6a.s.1u.2h.18.3.p.2.u.1.3.3.6a.t.1v.2f.18.3.q.2.m.1.a.3.6b.s.1v.j.3.1t.19.1.r.3.k.3.9.2.6b.z.1r.e.7.1r.22.4.j.4.9.1.6b.10.1q.7.1.5.9.1q.1v.4.4.4.h.6.6k.11.1r.2.i.1p.1x.3.4.4.g.6.6l.12.2f.1k.1y.3.3.4.f.6.6m.12.2g.1i.20.3.3.3.f.6.6m.13.2f.1i.20.4.2.3.e.7.6l.14.2f.1h.22.4.2.3.b.9.6k.15.2f.1g.24.5.1.2.b.9.6k.16.2e.1f.26.5.1.2.7.d.9.1.3.2.63.17.2e.1e.27.5.9.f.2.2.3.1.4.2.62.17.2f.1d.28.6.8.d.3.7.4.2.62.17.2e.1d.2a.6.7.d.3.1.a.1.63.1a.2b.1c.2b.6.8.c.l.1.5v.1e.28.1c.2c.5.8.b.4.1.1.2.c.5.5t.1g.26.1b.2d.6.8.9.4.5.d.4.5t.1h.26.19.2f.5.8.9.4.4.f.3.4.3.5o.1h.24.18.2g.7.6.9.4.4.g.2.2.7.5l.1n.20.17.2h.6.8.7.4.2.1.2.8.3.3.4.1.9.5j.1o.1z.17.2h.6.c.3.4.5.5.1.5.1.3.f.5g.1q.1z.15.2j.5.k.1.1.2.h.f.b.1.52.1r.1z.14.2k.4.k.1.1.1.1.1.i.e.9.2.52.1u.1w.13.2m.3.j.2.2.2.k.c.6.1.1.1.54.1u.1w.13.2n.2.1a.c.3.4.5.1.4z.1v.1w.12.2o.3.12.1.5.e.2.2.6.1.50.1u.1w.12.2o.4.3.2.12.d.c.2.4z.1t.1w.13.2o.9.12.c.5e.1s.1x.11.2r.1.1.7.y.a.1.3.g.1.4x.1s.1x.11.2w.6.3.1.6.1.l.2.1.5.4.3.g.1.4x.1r.1x.12.33.3.1.4.4.2.k.4.4.3.5e.1q.1y.12.3d.2.o.1.6.3.h.1.4w.1p.1y.12.36.2.4.2.x.3.e.2.4x.1o.1z.13.4c.2.f.1.4x.1m.21.12.9r.1m.21.12.3n.1.d.1.5p.1l.22.12.3o.1.c.2.5p.1k.21.13.c.1.38.9.6.3.5q.1i.21.14.c.1.37.9.7.3.5q.1i.21.14.b.2.37.8.8.3.5q.1i.21.14.a.3.31.1.4.9.8.3.5r.1h.20.15.a.3.30.3.2.9.8.5.5r.1g.20.15.9.5.2y.f.8.6.5r.1f.20.14.9.6.2x.g.8.5.5t.1e.20.14.7.7.2x.j.5.6.5v.1c.20.13.7.8.2w.k.5.6.1b.2.4j.1b.20.12.7.8.2v.1.1.m.2.7.5x.1a.20.10.9.8.2v.x.18.2.4o.18.21.z.a.8.2u.y.18.2.4p.17.21.y.b.7.2u.z.5z.17.22.w.c.7.2u.10.5y.17.22.v.d.7.2s.13.5y.16.22.v.d.6.2r.15.m.1.5b.15.24.u.c.7.2n.19.m.2.5a.15.24.u.c.6.2n.1b.m.1.5a.15.25.t.b.7.2l.1d.m.2.59.14.26.t.b.7.2j.1f.5x.14.26.t.b.6.2k.1g.5w.10.2a.t.c.5.2k.1f.5x.y.2c.t.c.5.2j.1h.5x.w.2d.s.d.4.2k.1h.5x.v.2e.q.f.3.2l.1i.5w.v.2e.p.34.1i.5w.u.2g.o.33.1i.5x.u.2g.o.33.1i.5x.v.2f.o.33.1h.5y.v.2f.n.34.1h.5y.v.2g.m.34.1h.5y.u.2h.l.35.1g.5z.u.2i.j.36.1g.60.s.2j.j.35.1g.61.s.2k.h.36.1f.62.s.2k.g.37.1f.62.r.2l.f.38.i.4.s.63.q.2m.f.38.d.b.p.65.p.2m.d.39.c.d.o.66.p.2m.c.3a.b.e.m.68.o.2n.6.3e.7.k.2.1.i.69.i.2.4.2o.2.3i.4.m.1.3.g.t.1.5g.j.74.1.1.h.t.1.5g.k.75.f.v.1.5g.k.76.e.v.1.5g.l.74.e.6c.m.74.d.w.2.5g.k.75.a.y.5.5e.j.79.1.2.2.10.4.5g.e.8g.4.5i.e.8g.3.5j.e.8g.2.5k.b.1.2.7c.2.1.2.u.1.3.1.5m.c.7e.4.u.3.5p.1.1.a.1.1.7b.4.t.4.5r.c.7c.3.t.3.5v.a.7c.1.t.3.5x.a.83.4.5y.b.81.5.5z.9.81.5.61.9.80.5.62.a.80.2.65.a.e6.b.e5.b.e5.a.4k.2.9l.9.4j.1.9n.8.e9.7.ea.7.9.4.dx.6.ec.6.ea.7.eb.7.ec.3.1.1.4f9.2.ec.1.ed.2.ed.4.38.5.1a.3.7.3.k.2.8p.2.37.a.r.1.1.3.1.1.2.1.5.j.2.q.8g.2.33.o.b.1w.8e.1.2.4.2o.2.5.t.8.25.88.2.1.6.1w.1.5.1.2.5.8.12.5.2d.85.a.1h.1.8.1t.3.2m.76.5.l.2.1.3.2.5.1c.25.1.2p.76.5.4.2.2.4.d.a.17.4w.6f.n.b.z.18.4q.6e.21.17.4q.69.1.1.2.3.1w.15.4x.68.3.4.1y.p.6.7.52.6o.1u.6.5.5.7.f.4o.6s.2a.3.5d.65.8m.2x' },
  };
  const worldBits = {};
  function worldMap(size) {
    if (worldBits[size]) return worldBits[size];
    const { w, h, runs } = WORLD[size], bits = new Uint8Array(w * h);
    let i = 0, land = 0;
    for (const r of runs.split('.')) { const n = parseInt(r, 36); if (land) bits.fill(1, i, i + n); i += n; land ^= 1; }
    return (worldBits[size] = { w, h, bits });
  }
  // Equal Earth, as baked: longitude and latitude to a pixel on a map w wide.
  function equalEarth(lon, lat, w, h) {
    const A1 = 1.340264, A2 = -0.081106, A3 = 0.000893, A4 = 0.003796, M = Math.sqrt(3) / 2;
    const l = lon * Math.PI / 180, t = Math.asin(M * Math.sin(lat * Math.PI / 180)), t2 = t * t, t6 = t2 * t2 * t2;
    const x = l * Math.cos(t) / (M * (A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2)));
    const y = t * (A1 + A2 * t2 + t6 * (A3 + A4 * t2));
    return [Math.round((x + 2.7064) / 5.4128 * w), Math.round((1.3173 - y) / 2.6346 * h)];
  }
  // Where each mountain is, and a nudge in pixels for neighbours that
  // would otherwise sit on top of each other.
  const PLACES = {
    alyeska: [-149.1, 60.97], kunama: [148.3, -36.46], pista3: [6.95, 45.71, -2, 0], aoraki: [170.1, -43.59],
    fuji: [138.7, 35.36], cervino: [7.66, 45.98, 2, -1], vinson: [-85.6, -78.53], kirinyaga: [37.3, -0.15, -1, -1],
    iztactepetl: [-97.3, 19.03], kilimanjaro: [37.4, -3.07, 1, 2], aconcagua: [-70.0, -32.65],
    annapurna: [83.8, 28.6, -2, 0], k2: [76.5, 35.88, 0, -1], chomolungma: [86.9, 27.99, 2, 1],
  };

  // The map screen: sea, land (snow towards the poles), a pale shore, the
  // road travelled so far, then every mountain: done ones with a little
  // flag, open ones bright, locked ones dithered grey. The one picked
  // blinks, with dotted lines to what finishing it would open.
  // On a phone the detailed map is wider than the screen, so the view
  // glides sideways to keep the mountain you've picked in the middle.
  let mapPan = null, mapSpots = {};
  // On a desktop the map leaves the TV and fills the window, on its own
  // canvas with more (but still chunky) pixels; a phone keeps it in the TV.
  const MAP_WIDE = !NARROW, MAP_W = 520, MAP_H = 272;
  const mapCanvas = document.getElementById('map-screen');
  let mapCtx = null, mapImg = null;
  function showMap(on) {
    if (!MAP_WIDE || !mapCanvas) return false;
    mapCanvas.hidden = !on;
    if (on && !mapCtx) {
      mapCanvas.width = MAP_W; mapCanvas.height = MAP_H;
      mapCtx = mapCanvas.getContext('2d');
      mapImg = mapCtx.createImageData(MAP_W, MAP_H);
    }
    return on;
  }
  function drawMap(wide = false) {
    const VW_ = wide ? MAP_W : VW, H_ = wide ? MAP_H : H, buf = wide ? mapImg : img;
    const { w, h, bits } = worldMap(wide ? 'huge' : 'big');
    let x0 = Math.floor((VW_ - w) / 2);
    const y0 = wide ? 16 : NARROW ? 30 : 8;
    if (w > VW_) {
      const o = champOptions(), sel = champ.stage === 'fly' ? champ.current : o[champ.pick % o.length], [lon, lat, dx = 0] = PLACES[sel.id];
      const focus = champ.stage === 'fly' ? planeAt(w, h, 0)[0] : equalEarth(lon, lat, w, h)[0] + dx;
      const want = Math.max(VW_ - w, Math.min(0, Math.round(VW_ / 2 - focus)));
      mapPan = mapPan === null ? want : mapPan + (want - mapPan) * 0.15;
      x0 = Math.round(mapPan);
    }
    const px = (x, y, c) => {
      if (x < 0 || x >= VW_ || y < 0 || y >= H_) return;
      const i = (y * VW_ + x) * 4; buf.data[i] = c[0]; buf.data[i + 1] = c[1]; buf.data[i + 2] = c[2]; buf.data[i + 3] = 255;
    };
    const land = (x, y) => x >= 0 && x < w && y >= 0 && y < h && bits[y * w + x] === 1;
    for (let y = 0; y < H_; y++) for (let x = 0; x < VW_; x++) px(x, y, VIC.blue);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (land(x, y)) {
        // Snow towards the poles, fading out through a dither, not a ruled line.
        const f = y < h / 2 ? (h * 0.15 - y) / (h * 0.06) : (y - h * 0.84) / (h * 0.03);
        const snow = f >= 1 || (f > 0 && hash(x * 13 + 5, y * 7) < f);
        px(x0 + x, y0 + y, snow ? VIC.white : VIC.green);
      }
      else if (land(x - 1, y) || land(x + 1, y) || land(x, y - 1) || land(x, y + 1)) px(x0 + x, y0 + y, VIC.lightBlue);
    }
    const at = id => { const [lon, lat, dx = 0, dy = 0] = PLACES[id], [x, y] = equalEarth(lon, lat, w, h); return [x0 + x + dx, y0 + y + dy]; };
    mapSpots = Object.fromEntries(MOUNTAINS.map(m => [m.id, at(m.id)]));   // for tapping
    const dots = (a, b, c, gap) => {
      const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1])));
      for (let k = 0; k <= n; k += gap) px(Math.round(a[0] + (b[0] - a[0]) * k / n), Math.round(a[1] + (b[1] - a[1]) * k / n), c);
    };
    const c = champ, opts = champOptions(), blink = Math.floor(performance.now() / 300) % 2;
    const flying = c.stage === 'fly', pick = flying ? c.current : opts[c.pick % opts.length];
    for (let k = 1; k < c.played.length; k++) dots(at(c.played[k - 1].id), at(c.played[k].id), VIC.white, 2);
    if (!flying) for (const id of pick.unlocks.filter(id => !c.open.has(id) && !skied(id))) dots(at(pick.id), at(id), VIC.yellow, 3);
    for (const m of MOUNTAINS) {
      const [mx, base] = at(m.id), open = opts.includes(m), picked = m === pick;
      // The ones you can pick bob gently, each to its own beat.
      const my = base - (open && !picked && !flying && Math.sin(performance.now() / 260 + mx) > 0 ? 1 : 0);
      if (skied(m.id)) {   // a little flag planted
        for (let r = -4; r <= 0; r++) px(mx, my + r, VIC.black);
        px(mx + 1, my - 4, VIC.red); px(mx + 2, my - 4, VIC.red); px(mx + 1, my - 3, VIC.red);
        continue;
      }
      // A peak: two rows, outlined in black.
      const ink = picked ? (blink ? VIC.yellow : VIC.white) : open ? VIC.white : null;
      for (const [dx, dy] of [[0, -2], [-1, -1], [0, -1], [1, -1], [-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0]]) {
        px(mx + dx, my + dy, ink || ((mx + dx + my + dy) % 2 ? VIC.black : VIC.white));   // locked: dithered grey
      }
      for (const [dx, dy] of [[0, -3], [-1, -2], [1, -2], [-2, -1], [2, -1], [-3, 0], [3, 0]]) px(mx + dx, my + dy, VIC.black);
      if (picked) for (let r = 0; r < 3; r++) for (let q = r - 2; q <= 2 - r; q++) px(mx + q, my - 9 + r, blink ? VIC.yellow : VIC.white);   // ▼ over it
    }
    if (!flying) {
      // The pick's name on the map, white on a black shadow, above its ▼.
      const [mx, my] = at(pick.id), label = pick.name.split(/ \(| "/)[0];
      const lw = label.length * 4 - 1, lx = Math.max(2, Math.min(VW_ - lw - 2, mx - (lw >> 1))), ly = Math.max(1, my - 16);
      for (const [dx, dy, c] of [[1, 1, VIC.black], [0, 0, VIC.white]]) {
        for (let k = 0; k < label.length; k++) {
          const bitsK = FONT3[label[k]] || FONT3[' '];
          for (let b = 0; b < 15; b++) if (bitsK[b] === '1') px(lx + k * 4 + (b % 3) + dx, ly + Math.floor(b / 3) + dy, c);
        }
      }
    }
    const plane = (sx, sy, ang) => {
      const cs = Math.cos(ang), sn = Math.sin(ang);
      PLANE.forEach((row, r) => [...row].forEach((ch, k) => {
        if (ch === '.') return;
        const u = k - 4, v = r - 3;
        px(Math.round(sx + u * cs - v * sn), Math.round(sy + u * sn + v * cs), ch === 'K' ? VIC.black : VIC.white);
      }));
    };
    if (flying) {
      // The plane, its dotted trail behind it, nose along the way it's going.
      const [sx, sy, ang] = planeAt(w, h, 0), [fx, fy] = planeAt(w, h, -1);
      dots([x0 + fx, y0 + fy], [x0 + sx, y0 + sy], VIC.white, 3);
      plane(x0 + sx, y0 + sy, ang);
    } else if (c.played.length) {
      // Where you are: the plane parked by the mountain you've just skied,
      // its name underneath in white. It takes off from here.
      const here = c.played[c.played.length - 1].id, [hx, hy] = at(here);
      plane(hx + PARKED[0], hy + PARKED[1], 0);
      const label = mountain(here).name.split(/ \(| "/)[0], lw = label.length * 4 - 1;
      const lx = Math.max(2, Math.min(VW_ - lw - 2, hx - (lw >> 1))), ly = hy + 3;
      for (const [dx, dy, col] of [[1, 1, VIC.black], [0, 0, VIC.white]]) {
        for (let k = 0; k < label.length; k++) {
          const bitsK = FONT3[label[k]] || FONT3[' '];
          for (let b = 0; b < 15; b++) if (bitsK[b] === '1') px(lx + k * 4 + (b % 3) + dx, ly + Math.floor(b / 3) + dy, col);
        }
      }
    }
  }
  // A little plane from above, pointing right: wings, tail, a dark nose.
  const PLANE = ['...X.....', '...XX....', 'X..XXX...', 'XXXXXXXXK', 'X..XXX...', '...XX....', '...X.....'];
  const PARKED = [8, -3];   // where it waits, beside the mountain's flag
  // Where a hop starts and ends, on a map w by h. The first hop of a
  // Championship flies in from off to the west.
  function flightEnds(w, h) {
    const spot = id => { const [lon, lat, dx = 0, dy = 0] = PLACES[id], [x, y] = equalEarth(lon, lat, w, h); return [x + dx, y + dy]; };
    const b = spot(champ.fly.to), f = champ.fly.from && spot(champ.fly.from);
    const a = f ? [f[0] + PARKED[0], f[1] + PARKED[1]] : [b[0] - 80, b[1] - 25];   // from where it was parked
    return [a, b];
  }
  // How long a hop takes: longer for further, 1 to 2 seconds.
  function flightTime() {
    const { w, h } = worldMap('big'), [a, b] = flightEnds(w, h);
    return 1000 + Math.min(1000, Math.hypot(b[0] - a[0], b[1] - a[1]) * 8);
  }
  // The plane's spot at t (0..1 of the hop): eased, on a gentle arc.
  function flightPos(w, h, t) {
    const [a, b] = flightEnds(w, h), e = t * t * (3 - 2 * t);
    return [a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e - Math.sin(Math.PI * t) * 8];
  }
  // Now: where the plane is and which way it points; back < 0: where it set off.
  function planeAt(w, h, back) {
    if (back < 0) return flightPos(w, h, 0);
    const t = Math.min(1, (performance.now() - champ.fly.at) / flightTime());
    const [x, y] = flightPos(w, h, t), [nx, ny] = flightPos(w, h, Math.min(1, t + 0.02)), [px0, py0] = flightPos(w, h, Math.max(0, t - 0.02));
    return [x, y, Math.atan2(ny - py0, nx - px0)];
  }


  // ----------------------------------------------------------------- flags
  // Each mountain's flags, drawn as pixel art. A flag is a size and a
  // function from a pixel to a colour key (null: see-through).
  const FC = { r: VIC.crimson, w: VIC.white, b: VIC.blue, c: VIC.cyan, g: VIC.green, y: [236, 200, 60], k: VIC.black, o: VIC.orange };
  const inCircle = (x, y, cx, cy, r2) => (x - cx) ** 2 + (y - cy) ** 2 <= r2;
  // The Union Jack in a top-left canton (Australia, New Zealand).
  const UNION_JACK = ['rwbwrwbwr', 'wrwwrwwrw', 'rrrrrrrrr', 'rrrrrrrrr', 'wrwwrwwrw', 'rwbwrwbwr'];
  const unionJack = (x, y) => UNION_JACK[y][x];
  const FLAG_ART = {
    us: [18, 12, (x, y) => x < 8 && y < 6 ? (x % 2 && y % 2 ? 'w' : 'b') : y % 2 ? 'w' : 'r'],
    alaska: [18, 12, (x, y) => {   // the Big Dipper and the North Star, gold on blue
      const stars = ['2,8', '4,10', '6,9', '5,7', '8,6', '10,5', '12,5'];
      if (stars.includes(x + ',' + y)) return 'y';
      if ((x === 15 && y >= 1 && y <= 3) || (y === 2 && x >= 14 && x <= 16)) return 'y';
      return 'b';
    }],
    aboriginal: [18, 12, (x, y) => inCircle(x, y, 8.5, 5.5, 10) ? 'y' : y < 6 ? 'k' : 'r'],
    australia: [18, 12, (x, y) => {
      if (x < 9 && y < 6) return unionJack(x, y);
      if ((x === 4 && y >= 8 && y <= 10) || (y === 9 && x >= 3 && x <= 5)) return 'w';   // Commonwealth star
      return ['13,2', '15,5', '11,5', '13,9', '14,7'].includes(x + ',' + y) ? 'w' : 'b';   // Southern Cross
    }],
    nz: [18, 12, (x, y) => {
      if (x < 9 && y < 6) return unionJack(x, y);
      // The Southern Cross: four red stars, two pixels square at this size.
      for (const [sx, sy] of [[13, 1], [16, 5], [10, 5], [13, 9]]) if (x - sx >= 0 && x - sx <= 1 && y - sy >= 0 && y - sy <= 1) return 'r';
      return 'b';
    }],
    maori: [18, 12, (x, y) => {   // Tino Rangatiratanga: black, white, red, and the koru
      // The koru: a white fern frond curling over, red at its heart,
      // its stem running into the white band.
      const K = ['.........', '...www...', '..w...w..', '.w..rr.w.', '.w.r..w..', '.w.r.....'];
      const ch = (K[y] || '')[x];
      if (ch === 'w' || ch === 'r') return ch;
      return y < 5 ? 'k' : y === 5 ? 'w' : 'r';
    }],
    italy: [18, 12, x => x < 6 ? 'g' : x < 12 ? 'w' : 'r'],
    swiss: [12, 12, (x, y) => (x >= 5 && x <= 6 && y >= 2 && y <= 9) || (y >= 5 && y <= 6 && x >= 2 && x <= 9) ? 'w' : 'r'],
    japan: [18, 12, (x, y) => inCircle(x, y, 8.5, 5.5, 12) ? 'r' : 'w'],
    penguin: [18, 12, (x, y) => {   // Antarctica has no flag of its own; it gets a penguin
      const P = ['.kk..', 'kwwko', 'kwwk.', 'kwwk.', '.kk..', 'o..o.'], ch = (P[y - 3] || '')[x - 7];
      return ch && ch !== '.' ? ch : 'c';
    }],
    kenya: [18, 12, (x, y) => {
      if (((x - 9) / 1.8) ** 2 + ((y - 5.5) / 4.2) ** 2 <= 1) return x === 9 ? (y === 4 || y === 7 ? 'w' : 'k') : 'r';   // the shield
      return y < 3 ? 'k' : y === 3 || y === 8 ? 'w' : y < 8 ? 'r' : 'g';
    }],
    mexico: [18, 12, (x, y) => {
      const e = { '8,4': 'o', '9,4': 'o', '8,5': 'k', '9,5': 'o', '8,6': 'o', '9,6': 'o', '8,7': 'g', '9,7': 'g' }[x + ',' + y];
      return e || (x < 6 ? 'g' : x < 12 ? 'w' : 'r');
    }],
    tanzania: [18, 12, (x, y) => {
      const d = y - (11 - x * 0.647);
      return Math.abs(d) < 1.5 ? 'k' : Math.abs(d) < 2.5 ? 'y' : d < 0 ? 'g' : 'c';
    }],
    argentina: [18, 12, (x, y) => (inCircle(x, y, 8.5, 5.5, 2.5) ? 'y' : y < 4 || y >= 8 ? 'c' : 'w')],
    nepal: [11, 14, (x, y) => {   // the only flag that isn't a rectangle
      const R = ['b..........', 'bb.........', 'brb........', 'brrb.......', 'brwrb......', 'bwwwrb.....', 'brrrrrb....',
        'brrrbbbb...', 'brrrrb.....', 'brrrrrb....', 'brrwrrrb...', 'brwwwrrrb..', 'brrwrrrrrb.', 'bbbbbbbbbbb'];
      const ch = R[y][x];
      return ch === '.' ? null : ch;
    }],
    pakistan: [18, 12, (x, y) => {
      if (x < 4) return 'w';
      if (['14,3', '13,4', '14,4', '15,4', '14,5'].includes(x + ',' + y)) return 'w';   // the star
      return inCircle(x, y, 11, 6, 16) && !inCircle(x, y, 12.5, 5, 11) ? 'w' : 'g';   // the crescent
    }],
    tibet: [18, 12, (x, y) => {   // the snow mountain, the sun and its red and blue rays, a gold border
      if (x === 0 || y === 0 || y === 11) return 'y';
      if (y >= 8 && Math.abs(x - 9) <= (y - 7) * 2.5) return 'w';
      if (inCircle(x, y, 9, 6, 4)) return 'y';
      return Math.floor((Math.atan2(y - 7, x - 9) + Math.PI) / (Math.PI / 6)) % 2 ? 'r' : 'b';
    }],
    // Not a flag: Random's question mark, in the same frame.
    random: [18, 12, (x, y) => {
      const Q = ['.www.', 'w...w', '....w', '...w.', '..w..', '.....', '..w..'], ch = (Q[y - 2] || '')[x - 6];
      return ch === 'w' ? 'w' : 'b';
    }],
    china: [18, 12, (x, y) => {
      if ((x === 3 && y >= 2 && y <= 4) || (y === 3 && x >= 2 && x <= 4)) return 'y';
      return ['6,1', '7,2', '7,4', '6,5'].includes(x + ',' + y) ? 'y' : 'r';
    }],
  };
  const FLAGS_OF = {
    alyeska: ['us', 'alaska'], kunama: ['aboriginal', 'australia'], pista3: ['italy'], aoraki: ['maori', 'nz'],
    fuji: ['japan'], cervino: ['swiss', 'italy'], vinson: ['penguin'], kirinyaga: ['kenya'], iztactepetl: ['mexico'],
    kilimanjaro: ['tanzania'], aconcagua: ['argentina'], annapurna: ['nepal'], k2: ['pakistan'], chomolungma: ['tibet', 'china'],
  };
  // A flag as a little canvas, scaled up in pixels.
  function flagCanvas(id) {
    const [w, h, px] = FLAG_ART[id], cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    cv.className = 'flag' + (id === 'nepal' ? ' shaped' : '');
    const fx = cv.getContext('2d'), im = fx.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const c = FC[px(x, y)];
      if (!c) continue;
      const i = (y * w + x) * 4;
      im.data[i] = c[0]; im.data[i + 1] = c[1]; im.data[i + 2] = c[2]; im.data[i + 3] = 255;
    }
    fx.putImageData(im, 0, 0);
    return cv;
  }
  const mountain = id => MOUNTAINS.find(m => m.id === id);
  // Lowest first, which is also easiest first.
  const metresOf = m => +m.height.replace(/[^0-9]/g, '');
  SINGLE_COURSES.push(...[...MOUNTAINS].sort((a, b) => metresOf(a) - metresOf(b)).map(m => m.id));
  try { singleIndex = Math.max(0, SINGLE_COURSES.indexOf(localStorage.getItem('slalom_single_course') || 'random')); } catch (_) {}
  // Names for tight spots: the pick button and result card, and the
  // course list. Most drop the bracket; the finale keeps its famous name.
  const shortName = m => m.short || m.name.split(' (')[0];
  const listName = m => m.list || m.name.split(/ \(| "/)[0];

  // Each mountain's slope. Difficulty comes from height (0 the lowest, 1
  // the highest): closer poles, wider swings, more bunched-up stretches,
  // a narrower piste with more on it. Then each mountain's own character
  // on top. Par and three-star times come from autopilot runs of each.
  const lerp = (a, b, t) => a + (b - a) * t;
  const BY_HEIGHT = MOUNTAINS.map(m => m.id).sort((a, b) => metres(a) - metres(b));
  function metres(id) { return +mountain(id).height.replace(/[^0-9]/g, ''); }
  const CHARACTER = {
    // A narrow chute near the bottom: the trees close in, no way out.
    alyeska: { wildlife: { odds: 0.02, kinds: { bear: 1, wolf: 1 } }, fans: 120, cameras: 45, heli: true, edgeNets: 0.5, lift: true, arena: true, width: [[0, 44], [0.7, 44], [0.76, 27], [0.94, 27], [1, 36]] },
    // Broad and gentle: long lazy bends, little on the piste.
    kunama: { fans: 120, cameras: 45, moths: true, edgeNets: 0.5, lift: true, arena: true, width: 50, sway: 0.55, twist: 1.2, crowd: 0.3, quick: 0 },
    // The Grand Muret: 76%, right after the start. The slope drops away,
    // you fly for a few poles, then it eases.
    // Room to tuck on the pitch, then the poles close in below it.
    pista3: { fans: 160, cameras: 60, edgeNets: 0.8, lift: true, arena: true, gaps: [[0, 170], [0.42, 160], [0.57, 75], [1, 64]], quick: 0, slope: [[0, 1], [0.05, 1], [0.08, 1.5], [0.6, 1.5], [0.66, 1]],
      signs: [{ t: 0.05, lines: ['GRAND MURET', '76%'] }] },
    // In 1991 a rock avalanche sheared 10 m off the summit: a stretch of
    // boulders strewn across the piste high up, and rocks among the trees
    // all the way down.
    // Below it, clumps of southern rātā flowering crimson.
    aoraki: { treeline: 0.5, wildlife: { odds: 0.025, kinds: { kea: 1 } }, rocks: 0.3, rata: 0.4, debris: [[0, 0], [0.1, 0], [0.13, 0.1], [0.3, 0.1], [0.34, 0]],
      signs: [{ t: 0.1, lines: ['ROCKFALL'] }] },
    // Even as a metronome: same gap, same swing, no bunching.
    // ...and cherry trees in bloom down the lower half.
    // ...and cherry groves, small at first, bigger and bigger, until by
    // the finish it's nearly all blossom. Photographers at the bottom.
    fuji: { cherry: [[0, 0], [0.25, 0], [0.45, 0.25], [0.75, 0.55], [0.95, 0.95]], fans: 8, cameras: 5, gapFirst: 82, gapLast: 82, offset: 13, offsetLast: 13, jitter: 0, quick: 0, twist: 0.5 },
    // Swiss top tight and technical; Italian bottom opens into long turns.
    cervino: { treeline: 0.7, fans: 120, cameras: 45, edgeNets: 0.5, lift: true, arena: true, borders: [0.5], signs: [{ t: 0.5, lines: ['ITALIA'], flag: 'it' }],
      welcome: 'BENVENUTI IN ITALIA !!!', gapFirst: 62, gapLast: 92, offset: 15, offsetLast: 11,
      width: [[0, 34], [0.47, 34], [0.53, 48], [1, 48]] },
    // An ice field: no trees, blocks of ice, crevasses, and penguins
    // (more than you'd really find that far inland, but it's their flag).
    vinson: { icy: true, crevasses: true, wind: true, forest: 0.45, fans: 0, penguinFans: true, wildlife: { odds: 0.03, kinds: { penguin: 1 } } },
    // The glacier shrinks: the piste narrows to a strip by the finish.
    // Bare dark rock beyond a snowfield that shrinks to a strip by the
    // finish (it slows you), boulders on it, giant groundsels.
    kirinyaga: { width: [[0, 46], [0.85, 24], [1, 22]], offset: 13, offsetLast: 9,
      scree: [[0, 0], [1, 0]], snowBand: [[0, 70], [0.6, 22], [0.9, 6], [1, 4]], darkRock: true,
      groundsels: true, rocks: 0.45, forest: 0.4 },
    // The serpent: the twistiest piste, long S-bends.
    // ...run at first light: warm snow and long shadows.
    iztactepetl: { twist: 1.8, sway: 0.6, dawn: true, treeline: 1.1 },
    // The long one: steady, not tricky.
    // Mostly bare volcanic rock now: scree patches all over, boulders, few
    // trees, and ice cliffs of the last glaciers up top.
    kilimanjaro: { scree: [[0, 0], [0.3, 0.05], [1, 0.3]], snowBand: [[0, 140], [0.75, 30], [1, 22]],
      rocks: 0.75, forest: 0.45, bushes: true, poles: 35, reds: 6, gapFirst: 86, gapLast: 74, jitter: 2, quick: 1 },
    // A high, dry desert mountain: penitentes in fields, boulders and
    // tussock grass, no trees.
    aconcagua: { penitentes: 0.6, rocks: 1, forest: 0.4, tussock: true, dogs: 0.06 },
    // Long the deadliest 8,000er, mostly to avalanches; and "full of food".
    annapurna: { wildlife: { odds: 0.016, kinds: { leopard: 1 } }, avalanche: { from: 9, to: 22, hold: 24, minV: 57, breakUp: true, throws: true }, pines: 1.6, treeline: 1.1 },
    // The Savage Mountain: the most technical slalom of all.
    // ...run at night: dim all round, a headlamp ahead.
    // The Bottleneck: a serac over the piste for a long stretch, shedding
    // ice. Above any treeline: rock only. Longer, tighter bunched runs.
    k2: { night: [[0, 0.88], [1, 0.88]], wind: true, wildlife: { odds: 0.016, kinds: { leopard: 1 } },
      serac: { from: 0.4, to: 0.7, side: 1 }, rocks: 1, forest: 0.5,
      quick: 2, quickLen: 7, quickGap: 36, offset: 15, offsetLast: 15, gapFirst: 82, gapLast: 50 },
    // The Hornbein Couloir first: steep, narrow, zigzagging between rock
    // walls, no poles; then out onto the North Face.
    chomolungma: { rocks: 1, fences: 0, camp: true, heli: true, couloir: { start: 100, rows: 1200, open: 90, hw: 15, slope: 1.6,
      // Gentle swings, then dangerous ones, each just within reach.
      bends: [[0, 0], [160, 18], [300, -20], [420, 22], [600, 5], [700, -26], [820, 16],
        [960, -10], [1080, 20], [1200, 0]],
      sign: ['HORNBEIN', 'COULOIR'] } },
  };
  // Par and three-star times (cs), scaled from Single's by how long the
  // autopilot takes on each. Re-run when a course changes.
  const PAR = {
    alyeska: [3468, 3342], kunama: [3620, 3489], pista3: [3887, 3746], aoraki: [3371, 3249],
    fuji: [3481, 3355], cervino: [2860, 2756], vinson: [3046, 2935], kirinyaga: [3057, 2947],
    iztactepetl: [3017, 2907], kilimanjaro: [4597, 4430], aconcagua: [2703, 2605],
    annapurna: [2716, 2617], k2: [2532, 2440], chomolungma: [4170, 4018],
  };
  function shapeOf(m) {
    const d = BY_HEIGHT.indexOf(m.id) / (BY_HEIGHT.length - 1);
    const off = lerp(11, 14, d);
    return Object.assign({}, SHAPE, {
      gapFirst: Math.round(lerp(100, 88, d)), gapLast: Math.round(lerp(72, 58, d)),
      offset: off, offsetLast: off,
      quick: d < 0.25 ? 1 : d < 0.7 ? 2 : 3,
      width: Math.round(lerp(44, 36, d)),
      crowd: lerp(0.6, 1.6, d),
    }, CHARACTER[m.id], { par: PAR[m.id][0], star3: PAR[m.id][1] });
  }

  // champ: null outside a Championship. stage: 'pick' (where next), 'intro'
  // (the mountain's card), 'run', 'result' (after a course), 'done'.
  let champ = null;
  const champEl = document.getElementById('champ');
  const champParts = Object.fromEntries(['head', 'sub', 'flags', 'pick', 'prev', 'go', 'next', 'text', 'list', 'prompt']
    .map(k => [k, document.getElementById('champ-' + k)]));
  const cardEl = champEl.parentElement;
  const champUp = () => !!champ && champ.stage !== 'run' && champ.stage !== 'save' && !overlayEl.hidden;

  function startChampionship() {
    titleCardEl.hidden = true;
    champ = { played: [], open: new Set(['alyeska', 'kunama']), pick: 0, current: null, stage: 'pick',
      god: godMode, id: null, ranked: !!juicer, server: null, check: Promise.resolve() };
    showChamp();
    // Ranked from here, if the server's there: it hands out the id now,
    // a session per mountain later, and checks each one as it ends.
    if (juicer) {
      const c = champ;
      c.server = juicer.rpc('slalom_start_champ', { p_god: c.god }).then(({ data, error }) => {
        if (!error && data && data.champ) c.id = data.champ; else c.ranked = false;
      }, () => { c.ranked = false; });
      fetchLeaderboard(champBoard());   // so the end knows what it must beat
    }
  }
  const champBoard = () => boardOf(false, champ ? champ.god : godMode, null, true);
  // The next mountain's session, once the last one's been checked.
  async function openChampSession() {
    const c = champ;
    sessionId = null; endPromise = null; edges = Promise.resolve();
    sessionGod = c.god;
    if (!c.ranked) return;
    fetchLeaderboard(boardOf(false, c.god, c.current.id));   // so its end knows what it must beat
    await c.server; await c.check;
    if (!c.ranked || !c.id) { c.ranked = false; return; }
    try {
      const { data, error } = await juicer.rpc('slalom_start_champ_course', { p_champ: c.id, p_course: c.current.id });
      if (!error && data && data.session) sessionId = data.session; else c.ranked = false;
    } catch (_) { c.ranked = false; }
  }
  // A mountain's over: the server checks it straight away. If it turns it
  // down (or can't be reached), the rest of the Championship is unranked.
  function checkChampCourse(points) {
    const c = champ;
    if (!c.ranked || !sessionId) { c.ranked = false; return; }
    const id = sessionId, payload = runPayload(), ended = endPromise;
    c.check = c.check.then(() => ended).then(() => juicer.rpc('slalom_check_champ_course', { p_session: id, p_payload: payload }))
      .then(({ data, error }) => { if (error || data !== points) c.ranked = false; }, () => { c.ranked = false; });
  }

  // What can be picked now: open and not yet skied, west to east; only the
  // finale once nine are done. If crashes have left nothing open, the two
  // lowest not yet skied open up, so every Championship reaches the end.
  const skied = id => champ.played.some(p => p.id === id);
  // Testing only: ?allmountains opens every mountain, the finale too.
  const ALL_OPEN = /[?&]allmountains\b/.test(location.search);
  function champOptions() {
    if (ALL_OPEN) return MOUNTAINS.filter(m => !skied(m.id)).sort((a, b) => a.lon - b.lon);
    if (champ.played.length === CHAMP_COURSES - 1) return [mountain(FINALE)];
    const left = () => MOUNTAINS.filter(m => m.id !== FINALE && champ.open.has(m.id) && !skied(m.id));
    if (!left().length) MOUNTAINS.filter(m => m.id !== FINALE && !skied(m.id)).slice(0, 2).forEach(m => champ.open.add(m.id));
    return left().sort((a, b) => a.lon - b.lon);
  }

  const champTotal = () => champ.played.reduce((t, p) => t + p.points, 0);
  function champListHtml() {
    if (!champ.played.length) return '';
    // Stars, time (a wipeout has none), points, in columns.
    const cols = (stars, time, pts) => `<span class="cols"><b>${stars}</b><b>${time}</b><b>${pts}</b></span>`;
    // The total time only means something if every course was finished.
    const all = champ.played.every(p => p.finished);
    const totalCs = champ.played.reduce((a, p) => a + p.time_cs, 0);
    return champ.played.map((p, i) => `<li><span>${i + 1} ${listName(mountain(p.id))}</span>${
      cols(p.finished ? '*'.repeat(p.stars) : '', p.finished ? fmt(p.time_cs) : 'WIPEOUT', p.points)}</li>`).join('')
      + `<li class="total"><span>TOTAL</span>${cols('', all ? fmt(totalCs) : '', champTotal())}</li>`;
  }

  function showChamp() {
    const c = champ, P = champParts, n = c.played.length + (c.stage === 'result' || c.stage === 'done' ? 0 : 1);
    cardEl.classList.add('champ-mode');
    overlayEl.classList.toggle('map-mode', c.stage === 'pick' || c.stage === 'fly');
    document.body.classList.toggle('map-mode', c.stage === 'pick' || c.stage === 'fly');
    overlayEl.classList.toggle('flying', c.stage === 'fly');
    if (c.stage === 'fly') {   // just the map and the plane; the card comes back on landing
      overlayEl.hidden = false;
      requestAnimationFrame(() => overlayEl.classList.add('visible'));
      return;
    }
    champEl.hidden = false;
    P.pick.hidden = c.stage !== 'pick';
    P.flags.hidden = c.stage !== 'intro' && c.stage !== 'pick' && c.stage !== 'result';
    P.prev.hidden = P.next.hidden = c.stage !== 'pick' || champOptions().length < 2;
    P.list.innerHTML = c.stage === 'intro' ? '' : champListHtml();
    if (c.stage === 'pick') {
      const opts = champOptions(), m = opts[c.pick % opts.length];
      P.head.textContent = `COURSE ${n} OF ${CHAMP_COURSES}`;
      P.sub.textContent = n === 1 ? 'A WORLD TOUR ON SKIS. WHERE TO FIRST?' : 'WHERE NEXT?';
      // A bracketed part goes on its own, smaller line.
      const [main, rest] = shortName(m).split(' (');
      P.go.innerHTML = rest ? `${main}<small>(${rest}</small>` : main;
      P.flags.replaceChildren(...FLAGS_OF[m.id].map(flagCanvas));   // whose mountain it is
      const next = m.unlocks.filter(id => !c.open.has(id) && !skied(id));
      P.text.textContent = `${m.country} · ${m.height}` + (m.id === FINALE ? ' · THE FINALE'
        : next.length ? ` · FINISH TO UNLOCK: ${next.map(id => shortName(mountain(id))).join(', ')}` : '');
      P.text.style.textAlign = 'center';
      P.prompt.textContent = NARROW ? 'ARROWS TO CHOOSE · TAP THE NAME TO GO' : 'LEFT / RIGHT CHOOSES · SPACE GOES';
    } else if (c.stage === 'intro') {
      const m = c.current;
      P.head.textContent = `COURSE ${n}: ${m.name}`;
      P.sub.textContent = `${m.country} · ${m.height}`;
      P.flags.replaceChildren(...FLAGS_OF[m.id].map(flagCanvas));
      P.text.textContent = m.fact.toUpperCase();
      if (m.venus) {   // the morning star, shimmering by the story
        const star = document.createElement('span');
        star.className = 'venus';
        P.text.appendChild(star);
      }
      P.text.style.textAlign = 'left';
      P.prompt.textContent = NARROW ? 'TAP TO START' : 'PRESS SPACE TO START';
    } else if (c.stage === 'result') {
      const p = c.played[c.played.length - 1];
      P.head.textContent = p.finished ? 'FINISHED' : 'WIPEOUT';
      P.flags.replaceChildren(...FLAGS_OF[p.id].map(flagCanvas));
      P.sub.textContent = `${shortName(mountain(p.id))} +${p.points}` + (p.finished ? ` · TIME ${fmt(p.time_cs)}` : '') + (c.ranked ? '' : ' · UNRANKED');
      P.text.textContent = '';
      P.prompt.textContent = (NARROW ? 'TAP' : 'SPACE') + (c.played.length === CHAMP_COURSES ? ' TO SEE HOW YOU DID' : ' FOR THE NEXT MOUNTAIN');
      if (c.leg) lendRunCard();
    } else {
      P.head.textContent = 'CHAMPIONSHIP OVER';
      P.sub.textContent = `TOTAL ${champTotal()}`;
      P.text.textContent = '';
      P.prompt.textContent = (NARROW ? 'TAP' : 'SPACE') + ' FOR THE MENU';
    }
    overlayEl.hidden = false;
    requestAnimationFrame(() => overlayEl.classList.add('visible'));
  }

  // A mountain good enough for its own top 10: the run card's initials box
  // (and then that mountain's board) borrowed into the result card.
  const RUN_CARD_PARTS = [newTopEl, submitFormEl, submitStatusEl, leaderboardEl];
  const runCardHome = RUN_CARD_PARTS.map(el => { const mark = document.createComment(''); el.before(mark); return mark; });
  let lent = false;
  function lendRunCard() {
    lent = true;
    RUN_CARD_PARTS.forEach(el => champEl.insertBefore(el, champParts.prompt));
    lastSubmittedId = null;
    submitStatusEl.classList.remove('error');
    submitStatusEl.textContent = '';
    newTopEl.hidden = false; submitFormEl.hidden = false; leaderboardEl.hidden = true;
    try { initialsInputEl.value = localStorage.getItem('slalom_initials') || ''; } catch (_) {}
    SFX.playQualify();
    setTimeout(() => { if (lent) initialsInputEl.focus(); }, 450);
  }
  function returnRunCard() {
    if (!lent) return;
    lent = false;
    if (document.activeElement === initialsInputEl) initialsInputEl.blur();
    RUN_CARD_PARTS.forEach((el, k) => runCardHome[k].after(el));
    newTopEl.hidden = true; submitFormEl.hidden = true; leaderboardEl.hidden = true;
    submitStatusEl.textContent = '';
  }

  function hideChamp() {
    returnRunCard();
    cardEl.classList.remove('champ-mode');
    overlayEl.classList.remove('map-mode');
    document.body.classList.remove('map-mode');
    overlayEl.classList.remove('flying');
    champEl.hidden = true;
  }

  // Space, Enter, A, Start or a tap: whatever the screen is waiting for.
  function champGo() {
    const c = champ;
    if (c.stage === 'pick') {
      // Off to the next mountain: the plane flies there over the map.
      const opts = champOptions();
      c.current = opts[c.pick % opts.length];
      const from = c.played.length ? c.played[c.played.length - 1].id : null;
      c.fly = { from, to: c.current.id, at: performance.now() };
      c.stage = 'fly';
      showChamp();
      SFX.playFlight(flightTime() / 1000);
    } else if (c.stage === 'fly') {   // landed, or skipped
      c.stage = 'intro';
      buildCourse(c.current.seed, false, shapeOf(c.current));   // its slope, behind the card
      showChamp();
    } else if (c.stage === 'intro') {
      c.stage = 'run';
      hideChamp();
      startRun();
    } else if (c.stage === 'result') {
      returnRunCard();
      c.leg = null;
      c.stage = c.played.length === CHAMP_COURSES ? 'done' : 'pick';
      c.pick = 0;
      if (c.stage === 'pick') toTitle(true);
      showChamp();
    } else {
      const total = champTotal();
      if (total > best.championship) {
        best.championship = total;
        try { localStorage.setItem(BEST_KEYS.championship, total); } catch (_) {}
      }
      showChampSave();
    }
  }
  // The end: the run card, for the whole Championship. Initials if the
  // total makes the top 10 (and every mountain passed its check), else
  // straight to the board.
  async function showChampSave() {
    const c = champ;
    c.stage = 'save';
    hideChamp();
    overlayEl.hidden = true;
    if (c.ranked) await c.check;
    if (champ !== c) return;
    const total = champTotal();
    overlayWordEl.textContent = 'CHAMPIONSHIP';
    overlayTitleEl.className = '';
    runPisteEl.textContent = 'ALL 10 MOUNTAINS';
    runPisteEl.hidden = false;
    finalScoreEl.textContent = total;
    finalStarsEl.hidden = true;
    const all = c.played.every(p => p.finished);
    breakdownEl.textContent = all ? `TIME ${fmt(c.played.reduce((a, p) => a + p.time_cs, 0))}` : 'WIPEOUTS INCLUDED';
    breakdownEl.hidden = false;
    lastSubmittedId = null;
    submitStatusEl.classList.remove('error');
    const canSave = !!(c.ranked && c.id && total > 0 && makesTop10(total, champBoard()));
    submitFormEl.hidden = !canSave;
    leaderboardEl.hidden = canSave;
    newTopEl.hidden = !canSave;
    if (canSave) SFX.playQualify();
    submitStatusEl.textContent = c.god ? 'GOD MODE RUN' : c.ranked ? '' : 'UNRANKED CHAMPIONSHIP';
    try { initialsInputEl.value = localStorage.getItem('slalom_initials') || ''; } catch (_) {}
    overlayEl.hidden = false;
    requestAnimationFrame(() => overlayEl.classList.add('visible'));
    pickCard(0);
    if (canSave) setTimeout(() => { if (!overlayEl.hidden) initialsInputEl.focus(); }, 450);
    else showBoard(champBoard());
  }
  function champStep(d) {
    if (champ.stage !== 'pick') return;
    const n = champOptions().length;
    champ.pick = (champ.pick + d + n) % n;
    showChamp();
  }

  // A course is over: keep its points, open what it earned, show the tally.
  function champCourseOver(finished) {
    const c = champ, m = c.current;
    c.played.push({ id: m.id, points: points(), stars: finished ? stars() : 0, finished, time_cs: runCs() });
    checkChampCourse(points());
    // Good enough for this mountain's own top 10? Then its initials box.
    c.leg = c.ranked && sessionId && points() > 0 && makesTop10(points(), boardOf(false, c.god, m.id)) ? sessionId : null;
    // A crash opens just one: the first neighbour not already open.
    const fresh = m.unlocks.filter(id => !c.open.has(id) && !skied(id));
    (finished ? fresh : fresh.slice(0, 1)).forEach(id => c.open.add(id));
    c.stage = 'result';
    showChamp();
  }

  champParts.prev.addEventListener('click', (e) => { e.currentTarget.blur(); champStep(-1); });
  champParts.next.addEventListener('click', (e) => { e.currentTarget.blur(); champStep(1); });
  champParts.go.addEventListener('click', (e) => { e.currentTarget.blur(); champGo(); });
  // A tap anywhere on the card moves things on, except on the pick screen,
  // where the name is the button.
  cardEl.addEventListener('click', (e) => { if (champUp() && champ.stage !== 'pick' && !e.target.closest('button, form, #leaderboard')) champGo(); });
  // Single on a mountain: its Championship card first (name, flags, the
  // story), then Space or a tap skis it. RUN AGAIN and R skip the card.
  // (singleIntro, the mountain on the card, is declared up top.)
  const introUp = () => !!singleIntro && !overlayEl.hidden;
  function showSingleIntro(m) {
    const P = champParts;
    singleIntro = m;
    titleCardEl.hidden = true;
    buildCourse(m.seed, false, shapeOf(m));   // its slope, behind the card
    cardEl.classList.add('champ-mode');
    champEl.hidden = false;
    P.pick.hidden = true;
    P.flags.hidden = false;
    P.list.innerHTML = '';
    P.head.textContent = m.name;
    P.sub.textContent = `${m.country} · ${m.height}`;
    P.flags.replaceChildren(...FLAGS_OF[m.id].map(flagCanvas));
    P.text.textContent = m.fact.toUpperCase();
    if (m.venus) {   // the morning star, shimmering by the story
      const star = document.createElement('span');
      star.className = 'venus';
      P.text.appendChild(star);
    }
    P.text.style.textAlign = 'left';
    P.prompt.textContent = NARROW ? 'TAP TO START' : 'PRESS SPACE TO START';
    overlayEl.hidden = false;
    requestAnimationFrame(() => overlayEl.classList.add('visible'));
  }
  function introGo() {
    if (!introUp()) return;
    startRun();   // hides the card and clears singleIntro
  }
  cardEl.addEventListener('click', (e) => { if (introUp() && !e.target.closest('button')) introGo(); });

  overlayEl.addEventListener('click', (e) => {
    if (!champUp()) return;
    if (champ.stage === 'fly') { champGo(); return; }   // a tap skips the flight
    if (champ.stage !== 'pick' || e.target.closest('.card')) return;
    // A tap on the map: pick the nearest open mountain; tap it again to go.
    let gx, gy;
    if (MAP_WIDE) {   // the map canvas, letterboxed to fit the window
      const r = mapCanvas.getBoundingClientRect(), k = Math.min(r.width / MAP_W, r.height / MAP_H);
      gx = (e.clientX - r.left - (r.width - MAP_W * k) / 2) / k; gy = (e.clientY - r.top - (r.height - MAP_H * k) / 2) / k;
    } else {
      const r = canvas.getBoundingClientRect();
      gx = (e.clientX - r.left) / r.width * VW; gy = (e.clientY - r.top) / r.height * H;
    }
    const opts = champOptions();
    let best = -1, bestD = 12;
    opts.forEach((m, k) => { const [x, y] = mapSpots[m.id] || [-99, -99], d = Math.hypot(gx - x, gy - (y - 1)); if (d < bestD) { bestD = d; best = k; } });
    if (best < 0) return;
    if (best === champ.pick % opts.length) champGo();
    else { champ.pick = best; showChamp(); }
  });

  // -------------------------------------------------------------- overlay
  // Two steps, like snake-bit: the run's breakdown and the initials first,
  // then, once saved or skipped, the top 10 with the new entry flashing.
  let lastSubmittedId = null;

  function showOverlay(finished) {
    if (champ) { champCourseOver(finished); return; }
    if (course.endless) SFX.playRunOver();
    overlayWordEl.textContent = finished || ranOut ? 'GAME OVER' : 'WIPEOUT';
    overlayTitleEl.className = 'bad';
    finalScoreEl.textContent = points();
    // The piste the run was on, with its flags.
    const m = runClassic ? mountain(runClassic) : null;
    runPisteEl.textContent = course.endless ? 'ENDLESS' : m ? m.short || m.name.split(/ \(| "/)[0] : 'RANDOM';
    if (!course.endless) {
      const row = document.createElement('div');
      row.className = 'flag-row';
      row.append(...(m ? FLAGS_OF[m.id] : ['random']).map(flagCanvas));
      runPisteEl.appendChild(row);
    }
    runPisteEl.hidden = false;
    finalStarsEl.hidden = !finished;
    if (finished) paintCardStars(stars());
    // What happened on the run, never how it was scored: the arithmetic
    // stays in the server's check, not on screen as a recipe.
    breakdownEl.textContent = finished ? `TIME ${fmt(runCs())}` : ranOut ? 'OUT OF MISSES' : hitWhat === 'SLUFF' ? 'CAUGHT BY THE SLUFF' : hitWhat === 'AVALANCHE' ? 'CAUGHT BY THE AVALANCHE' : hitWhat === 'ICEFALL' ? 'HIT BY THE ICEFALL' : `INTO THE ${hitWhat}`;
    breakdownEl.hidden = false;
    lastSubmittedId = null;
    submitStatusEl.classList.remove('error');
    // A ranked run that would make the top 10, crashes included, gets to
    // save it, as in snake-bit. Anything else goes straight to the board.
    const canSave = !!(sessionId && points() > 0 && makesTop10(points(), runBoard()));
    submitFormEl.hidden = !canSave;
    leaderboardEl.hidden = canSave;
    newTopEl.hidden = !canSave;
    if (canSave) SFX.playQualify();
    submitStatusEl.textContent = runGod ? 'GOD MODE RUN' : sessionId ? '' : 'UNRANKED RUN';
    try { initialsInputEl.value = localStorage.getItem('slalom_initials') || ''; } catch (_) {}
    overlayEl.hidden = false;
    requestAnimationFrame(() => overlayEl.classList.add('visible'));
    pickCard(0);
    if (canSave) setTimeout(() => { if (!overlayEl.hidden) initialsInputEl.focus(); }, 450);
    else showBoard(runBoard());
  }

  function hideOverlay() {
    cardClosed = false;
    singleIntro = null;
    hideChamp();
    newTopEl.hidden = true;
    if (document.activeElement === initialsInputEl) initialsInputEl.blur();
    overlayEl.classList.remove('visible');
    overlayEl.hidden = true;
    setBoardView(false);
  }

  // The crown: the top 10 on its own, any time but mid-countdown or while
  // a run's own card is on its way. A run in progress pauses under it and
  // carries on when the board closes.
  let boardView = false, boardPaused = false;
  function setBoardView(on) {
    boardView = on;
    for (const el of [overlayTitleEl, finalScoreRowEl, againRowEl, restartHintEl]) el.hidden = on;
    if (on) runPisteEl.hidden = true;
    closeRowEl.hidden = !on;
    if (on) {
      finalStarsEl.hidden = breakdownEl.hidden = submitFormEl.hidden = true;
      submitStatusEl.textContent = '';
      leaderboardEl.hidden = false;
    }
  }

  function openBoard() {
    if (boardView || !overlayEl.hidden) return;
    if (state !== 'title' && state !== 'running' && state !== 'paused' && !cardClosed) return;
    if (state === 'running') { togglePause(); boardPaused = true; }
    setBoardView(true);
    overlayEl.hidden = false;
    requestAnimationFrame(() => overlayEl.classList.add('visible'));
    showBoard(currentBoard());
  }

  function closeBoard() {
    if (!boardView) return;
    hideOverlay();
    if (boardPaused && state === 'paused') togglePause();
    boardPaused = false;
    if (state === 'crashed' || state === 'finished') { cardClosed = true; msgEl.textContent = startPrompt(); }
  }

  // CLOSE on a run's own card, as in snake-bit: the card goes and the
  // finished run stays on screen. Space or a tap then goes to the title.
  let cardClosed = false;
  const startPrompt = () => NARROW ? 'TAP TO RUN AGAIN' : 'SPACE TO RUN AGAIN';

  // After a run, going again is one key or tap; the menu is a step back:
  // Escape (or B) closes the card, and again goes to the title.
  function backOut() {
    if (cardClosed) toTitle();
    else closeCard();
  }
  // The card's buttons, for keys and controllers: left and right move the
  // pick, Space, Enter, A or Start press it. RUN AGAIN to begin with.
  const cardBtns = ['again-btn', 'menu-btn', 'card-close-btn'].map(id => document.getElementById(id));
  let cardPick = 0;
  const cardUp = () => !overlayEl.hidden && !boardView && !tally && (state === 'crashed' || state === 'finished');
  function pickCard(i) {
    cardPick = (i + cardBtns.length) % cardBtns.length;
    cardBtns.forEach((b, k) => b.classList.toggle('picked', k === cardPick));
  }

  function closeCard() {
    if (overlayEl.hidden || boardView) return;
    if (state !== 'crashed' && state !== 'finished') return;
    hideOverlay();
    cardClosed = true;
    msgEl.textContent = startPrompt();
  }

  // Step two: the run folds down to its score and the board takes over.
  function showLeaderboard() {
    if (document.activeElement === initialsInputEl) initialsInputEl.blur();
    newTopEl.hidden = true;
    submitFormEl.hidden = true;
    breakdownEl.hidden = true;
    leaderboardEl.hidden = false;
    showBoard(runBoard());
  }

  const placeholder = (text) => `<li class="note">${text}</li>`;

  // The last top 10 seen of each board, kept to decide whether a run
  // qualifies. Unknown (offline, not loaded yet) qualifies, so a real top
  // score is never lost.
  // Boards: Single, Endless, and each mountain's own ('classic:<id>'), each
  // with its secret god twin.
  const boardOf = (endless, god, classic = null, championship = false) =>
    (championship ? 'championship' : endless ? 'endless' : classic ? 'classic:' + classic : 'single') + (god ? ':god' : '');
  const currentBoard = () => bestMode() === 'championship' ? champBoard()
    : boardOf(bestMode() === 'endless', godMode, state === 'title' ? classicPick() : runClassic);
  const runBoard = () => champ && champ.stage === 'result' ? boardOf(false, champ.god, champ.current.id)
    : champ ? champBoard() : boardOf(course.endless, runGod, runClassic);
  // What sits above the TOP 10 bar on each board.
  const BOARD_TITLE = { single: 'SINGLE', endless: 'ENDLESS', championship: 'CHAMPIONSHIP' };
  const leaderboardCache = {};
  function makesTop10(score, board) {
    const top = leaderboardCache[board];
    if (!top || top.length < 10) return true;
    return score > top[9].score;
  }

  // Which board the list is showing: the run's on its card, the current
  // mode's under the crown. The secret ones say so in their headers.
  let shownBoard = 'single';
  function showBoard(board) {
    if (board !== shownBoard) leaderboardListEl.innerHTML = '';
    shownBoard = board;
    const classic = board.startsWith('classic:') ? mountain(board.split(':')[1]) : null;
    // The board's name (and flags) on the card's white, then TOP 10
    // alone in reverse video underneath.
    const god = board.endsWith(':god');
    const top = document.createElement('div');
    top.className = 'board-name';
    // On the run's own card the piste is already named under WIPEOUT, so
    // the heading keeps only the god-mode line there; the crown shows it all.
    const named = boardView;
    top.innerHTML = named
      ? (god ? 'SECRET GOD MODE<br>' : '') + (classic ? `SINGLE &middot; ${classic.short || classic.name.split(/ \(| "/)[0]}` : BOARD_TITLE[board.replace(':god', '')])
      : god ? 'SECRET GOD MODE' : '';
    if (classic && named) {   // every flag the mountain flies, in a row
      const row = document.createElement('div');
      row.className = 'flag-row';
      row.append(...FLAGS_OF[classic.id].map(flagCanvas));
      top.appendChild(row);
    }
    const bar = document.createElement('div');
    bar.className = 'board-bar';
    bar.textContent = 'TOP 10';
    boardTitleEl.replaceChildren(...(top.innerHTML ? [top] : []), bar);
    boardTitleEl.classList.toggle('god', board.endsWith(':god'));
    fetchLeaderboard(board);
  }

  async function fetchLeaderboard(board = currentBoard()) {
    const render = board === shownBoard, endless = board.startsWith('endless'), god = board.endsWith(':god');
    const classic = board.startsWith('classic:') ? board.split(':')[1] : null, champs = board.startsWith('championship');
    if (!juicer) { if (render) leaderboardListEl.innerHTML = placeholder('OFFLINE'); return; }
    if (render && !leaderboardListEl.children.length) leaderboardListEl.innerHTML = placeholder('LOADING...');
    const table = juicer.from(endless || classic || champs ? 'slalom_mode_scores' : god ? 'slalom_god_scores' : 'slalom_scores')
      .select('id, initials, score');
    const { data, error } = await (classic ? table.eq('mode', 'classic').eq('course', classic).eq('god', god)
      : champs ? table.eq('mode', 'championship').eq('god', god)
      : endless ? table.eq('mode', 'endless').eq('god', god) : table)
      .order('score', { ascending: false })       // highest first
      .order('created_at', { ascending: true })
      .limit(10);
    if (board !== shownBoard) { if (!error) leaderboardCache[board] = data; return; }
    if (error) { leaderboardListEl.innerHTML = placeholder('UNAVAILABLE'); return; }
    leaderboardCache[board] = data;
    if (!data.length) { leaderboardListEl.innerHTML = placeholder('NO SCORES YET'); return; }
    leaderboardListEl.innerHTML = data.map((row, i) => {
      const mine = row.id === lastSubmittedId ? ' class="mine"' : '';
      return `<li${mine}><span class="rank">${i + 1}.</span><span class="ini">${row.initials}</span><span class="sc">${row.score}</span></li>`;
    }).join('');
  }

  submitFormEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    const raw = initialsInputEl.value.trim().toUpperCase().slice(0, 3);
    if (!/^[A-Z]{1,3}$/.test(raw)) {
      submitStatusEl.textContent = 'THREE LETTERS';
      submitStatusEl.classList.add('error');
      return;
    }
    submitStatusEl.classList.remove('error');
    submitStatusEl.textContent = 'SUBMITTING...';
    submitBtnEl.disabled = skipBtnEl.disabled = true;
    try { localStorage.setItem('slalom_initials', raw); } catch (_) {}

    // A fast submit can outrun slalom_end_game; the server requires
    // ended_at, so wait for it rather than racing it.
    if (endPromise) await endPromise;

    const legSession = champ && champ.stage === 'result' ? champ.leg : null;
    if (legSession) await champ.check;   // its check first
    const { data, error } = legSession
      ? (champ.ranked ? await juicer.rpc('slalom_submit_champ_leg', { p_session: legSession, p_initials: raw.padEnd(3, '-') })
        : { data: null, error: { message: 'x: unranked championship' } })
      : champ && champ.stage === 'save'
      ? await juicer.rpc('slalom_submit_champ', { p_champ: champ.id, p_initials: raw.padEnd(3, '-'), p_score: champTotal() })
      : await juicer.rpc(course.endless ? 'slalom_submit_endless' : runClassic ? 'slalom_submit_course'
        : runGod ? 'slalom_submit_god_score' : 'slalom_submit_score', {
        p_session: sessionId,
        p_payload: { initials: raw.padEnd(3, '-'), ...runPayload() },
      });
    submitBtnEl.disabled = skipBtnEl.disabled = false;
    if (error) {
      submitStatusEl.textContent = error.message.replace(/^.*?:\s*/, '').toUpperCase();
      submitStatusEl.classList.add('error');
      return;
    }
    submitStatusEl.textContent = "YOU'RE ON THE BOARD!";
    lastSubmittedId = data || null;
    if (legSession) champ.leg = null;   // once per mountain
    showLeaderboard();
    SFX.playJingle();   // the big moment: your row lights up to this
  });

  skipBtnEl.addEventListener('click', showLeaderboard);
  againBtnEl.addEventListener('click', restart);
  document.getElementById('close-btn').addEventListener('click', closeBoard);
  document.getElementById('card-close-btn').addEventListener('click', (e) => { e.currentTarget.blur(); closeCard(); });
  document.getElementById('menu-btn').addEventListener('click', (e) => {
    e.currentTarget.blur();
    if (state === 'crashed' || state === 'finished') toTitle();
  });
  // Blurred straight away, so Space never "clicks" it again later.
  // A game controller, polled every frame like snake-bit's: the d-pad or
  // left stick turns while held, Start is Space, A is R, B closes the board
  // or the card. Typing initials, A submits and B skips. First pad only.
  let gpDir = null, gpPrev = [], gpV = 0;
  function pollGamepad() {
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    let pad = null;
    for (let i = 0; i < pads.length; i++) if (pads[i]) { pad = pads[i]; break; }
    if (!pad) { gpPrev = []; if (gpDir) { release('gp'); gpDir = null; } return; }
    const pressed = (i) => !!(pad.buttons[i] && pad.buttons[i].pressed);
    const justPressed = (i) => pressed(i) && !gpPrev[i];
    const typing = document.activeElement === initialsInputEl;

    const ax = pad.axes[0] || 0;
    const dir = splashUp || typing || boardView ? null
      : pressed(14) || ax < -0.5 ? 'left'
      : pressed(15) || ax > 0.5 ? 'right' : null;
    if (dir !== gpDir) {
      release('gp');
      if (dir) press('gp', dir);
      if (dir && champUp()) champStep(dir === 'left' ? -1 : 1);
      else if (dir && state === 'title' && !introUp()) chooseMode(modeIndex + (dir === 'left' ? -1 : 1));
      else if (dir && cardUp()) pickCard(cardPick + (dir === 'left' ? -1 : 1));
      gpDir = dir;
    }
    // Up and down on the pad pick Single's course on the title.
    const ay = pad.axes[1] || 0, vdir = pressed(12) || ay < -0.5 ? -1 : pressed(13) || ay > 0.5 ? 1 : 0;
    if (vdir !== gpV) {
      if (vdir && state === 'title' && !boardView && !splashUp && !introUp() && chosenMode() === 'single') chooseCourse(singleIndex + vdir);
      gpV = vdir;
    }

    if (splashUp) {
      if (justPressed(9) || justPressed(0)) dismissSplash();
    } else if (champUp()) {
      if (justPressed(9) || justPressed(0)) champGo();
      else if (justPressed(1)) toTitle();
    } else if (introUp()) {
      if (justPressed(9) || justPressed(0)) introGo();
      else if (justPressed(1)) toTitle();
    } else if (typing) {
      if (justPressed(0)) submitFormEl.requestSubmit();
      else if (justPressed(1)) showLeaderboard();
    } else if (boardView) {
      if (justPressed(9) || justPressed(1)) closeBoard();
      else if (justPressed(0)) { closeBoard(); restart(); }
    } else {
      if (justPressed(9)) spaceAction();
      else if (justPressed(0)) cardUp() ? spaceAction() : restart();
      else if (justPressed(1)) backOut();
    }
    if ([0, 1, 9, 14, 15].some(justPressed)) SFX.unlock();
    gpPrev = pad.buttons.map(b => !!b.pressed);
  }

  boardBtnEl.addEventListener('click', () => { boardBtnEl.blur(); openBoard(); });
  // Pause is Space, restart is R. Blurred like the crown.
  pauseBtnEl.addEventListener('click', () => { pauseBtnEl.blur(); spaceAction(); });
  // The middle button goes back to the title to pick a mode; mid-run that
  // drops the run, as R does. (R itself still restarts.)
  restartBtnEl.addEventListener('click', () => {
    restartBtnEl.blur();
    if (boardView || state === 'title' || state === 'starting') return;
    if (state === 'running' || state === 'paused') {
      runEnd = performance.now();
      SFX.stopSwoosh();
      closeSession();
    }
    toTitle();
  });

  // ----------------------------------------------------------------- loop
  // Physics runs on WALL time, in fixed substeps, never capped. The run
  // clock is wall time and the server checks it against its own wall clock,
  // so the slope has to move on that same timeline: if frames stall (slow
  // device, background tab) the skier must still cover the ground the clock
  // is charging for. A capped dt would quietly make slow devices post worse
  // times, and would turn frame throttling into a slow-motion mode.
  const STEP = 1 / 120;
  let last = performance.now();
  let acc = 0;
  function frame(now) {
    const dt = (now - last) / 1000;
    last = now;
    paintPauseIcon();
    pollGamepad();
    if (state === 'running') {
      acc += dt;
      while (acc >= STEP && state === 'running') { step(STEP); acc -= STEP; }
    } else {
      acc = 0;
      if (state === 'finished' || (state === 'crashed' && ranOut)) glide(Math.min(dt, 0.05));
      if (tally) updateTally(Math.min(dt, 0.05));
    }
    if (state === 'running' && onFire()) spawnEmbers();
    SFX.updateHeli(heliLevel());
    SFX.updateWind(windLevel());
    SFX.updateAvalanche(slideLevel());
    SFX.updateSluff(state === 'running' && sluff && sluff.v > 0 ? Math.max(0.15, Math.min(1, 1 - (skierY - sluff.y) / 120)) : 0);
    if (state === 'running') {
      SFX.updateSwoosh(speed / DOWN_SPEED, snowDepth(skierX, course.centerAt(skierY), skierY), heading !== 'down');
    }
    if (course && state !== 'title' && state !== 'paused' && state !== 'starting') {
      updateAnimals(Math.min(dt, 0.05));
      updateBirds(Math.min(dt, 0.05));
      updateMoths(Math.min(dt, 0.05));
      updatePetals(Math.min(dt, 0.05));
      updateStreaks(Math.min(dt, 0.05));
    }
    if (particles.length) updateParticles(Math.min(dt, 0.05));
    if (state === 'running' || state === 'crashed' || state === 'finished') paintHud();
    if (now > flashUntil && state !== 'paused') msgEl.textContent = cardClosed ? startPrompt() : '';
    if (!popEl.hidden) { if (now > popUntil || state === 'title') popEl.hidden = true; else placePop(); }
    render();
    requestAnimationFrame(frame);
  }

  prepareRun();
  chooseMode(0);
  if (juicer) setInterval(fetchLeaderboard, 60000);   // keeps makesTop10 current
  requestAnimationFrame(frame);
})();
