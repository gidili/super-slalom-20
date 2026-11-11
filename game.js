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
  const VW = NARROW ? 144 : W;
  const H = NARROW ? Math.round(VW * window.innerHeight / window.innerWidth) : 168;

  // The VIC-20's palette. Nothing outside this list is ever drawn.
  const VIC = {
    black: [0, 0, 0],          white: [255, 255, 255],
    red: [120, 41, 34],        cyan: [135, 214, 221],
    blue: [64, 49, 141],       green: [85, 160, 73],
    orange: [170, 116, 73],    lightBlue: [128, 128, 255],
    yellow: [191, 206, 114],
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

  const SKIER_Y = 48;          // skier's fixed screen row
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
  function pickRedPoles(seed) {
    const rnd = mulberry32((seed % 4294967296) ^ 0x5EED);
    const idx = Array.from({ length: POLE_COUNT - 1 }, (_, i) => i + 1);
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    return new Set(idx.slice(0, RED_COUNT));
  }

  // The poles in quick sections, by index. Sections never touch: at least
  // two ordinary gaps between them, and one before the finish.
  function pickQuickPoles(seed) {
    const rnd = mulberry32((seed % 4294967296) ^ 0x0B1C);
    const last = POLE_COUNT - 1 - QUICK_POLES;    // latest start
    for (;;) {
      const starts = [];
      for (let k = 0; k < QUICK_SECTIONS; k++) {
        starts.push(QUICK_FIRST + Math.floor(rnd() * (last - QUICK_FIRST + 1)));
      }
      starts.sort((a, b) => a - b);
      if (starts.every((s, k) => k === 0 || s - starts[k - 1] >= QUICK_POLES + 2)) {
        const set = new Set();
        for (const s of starts) for (let i = 0; i < QUICK_POLES; i++) set.add(s + i);
        return set;
      }
    }
  }

  let course = null;

  function buildCourse(seed, endless = false) {
    const redPoles = pickRedPoles(seed);
    const rnd = mulberry32(seed % 4294967296);
    const f1 = 0.006 + rnd() * 0.004, p1 = rnd() * Math.PI * 2;
    const f2 = 0.017 + rnd() * 0.008, p2 = rnd() * Math.PI * 2;
    const centerAt = y => W / 2 + 18 * Math.sin(y * f1 + p1) + 10 * Math.sin(y * f2 + p2);

    // The seed picks the first pole's side; after that they alternate, so
    // the line is a slalom, not a schuss. Each pole is passed on its
    // outside, away from the piste centre, which is what makes you weave.
    // The first pole too: every pole has a flag, so there's no free choice
    // that the rest of the course would then ignore.
    const first = rnd() < 0.5 ? -1 : 1;
    const quick = pickQuickPoles(seed);
    const poles = [];
    let y = START_PAD;
    for (let i = 0; i < (endless ? 0 : POLE_COUNT); i++) {
      if (i > 0) {
        y += quick.has(i) && quick.has(i - 1)
          ? QUICK_GAP
          : POLE_GAP_FIRST + (POLE_GAP_LAST - POLE_GAP_FIRST) * (i - 1) / (POLE_COUNT - 2);
      }
      y = Math.round(y);
      const side = i % 2 === 0 ? first : -first;
      const off = quick.has(i) ? QUICK_OFFSET + rnd() * 2 : POLE_OFFSET + rnd() * 4;
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
      .concat(poles.map(p => ({ y: p.y, x: p.x + p.side * LINE_WIDE })))
      .concat(endless ? [] : [{ y: finishY, x: centerAt(finishY) }]);
    const lineAt = (wy) => {
      if (wy <= 0) return pts[0].x;
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
      y: 64 + Math.floor(prnd() * 40),
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
    const lineEnd = endless ? Infinity : poles[POLE_COUNT - 1].y;
    course = { seed, centerAt, lineAt, poles, finishY, salt, titlePine, endless, lineEnd, extend, levelAt };
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
    let ac = null, master = null, noise = null, swoosh = null;
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

    // Endless, down to the last miss: blip blip blip, once.
    function playBlips() {
      if (!ac) return;
      const t = ac.currentTime;
      [0, 0.13, 0.26].forEach(d => note(1200, t + d, 0.08, 0.1, 'square'));
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
      unlock: safe(unlock), startSwoosh: safe(startSwoosh), updateSwoosh: safe(updateSwoosh),
      stopSwoosh: safe(stopSwoosh), playDash: safe(playDash), playBreak: safe(playBreak),
      playExplosion: safe(playExplosion), playFanfare: safe(playFanfare), toggleMute: safe(toggleMute),
      playCoin: safe(playCoin), playCount: safe(playCount), playTick: safe(playTick), playDing: safe(playDing), playNoBonus: safe(playNoBonus),
      playStar: safe(playStar), playJingle: safe(playJingle),
      playIgnite: safe(playIgnite), playDouse: safe(playDouse), playClack: safe(playClack), playBlips: safe(playBlips), playRunOver: safe(playRunOver), playQualify: safe(playQualify), playGrowl: safe(playGrowl),
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
  async function openSession(seq, endless = false) {
    sessionId = null;
    endPromise = null;
    edges = Promise.resolve();
    sessionGod = godMode;
    if (juicer) {
      try {
        const { data, error } = await (endless ? juicer.rpc('slalom_start_endless', { p_god: sessionGod })
          : juicer.rpc(sessionGod ? 'slalom_start_god_game' : 'slalom_start_game'));
        if (seq !== prepareSeq) return 0;
        if (!error && data && data.session) {
          sessionId = data.session;
          return Number(data.seed);
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
    missed > MISS_LIMIT ? 0 : Math.max(0, (PAR_CS - bonusCs()) * BONUS_PER_CS);
  const points = () => earned() + (state === 'finished' ? timeBonus() : 0);
  function stars() {
    if (state !== 'finished') return 0;
    if (missed === 0 && runCs() <= STAR3_CS) return 3;
    if (missed <= STAR2_MISSES && bonusCs() < PAR_CS) return 2;
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
  function toTitle() {
    state = 'title';
    ranOut = false;
    prepareRun();
    particles = [];
    hideOverlay();
    titleCardEl.hidden = false;
    countdownEl.hidden = true;
    tally = null;
    shownBonus = 0;
    bonusEl.hidden = true;
    passed = 0; missed = 0; reds = 0; clips = 0; nextPole = 0;
    streak = 0; streaks = []; clipPoints = 0; burned = { pine: 0, tree: 0, fence: 0 };
    survived = { fox: 0, wolf: 0, bear: 0 };
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
    }
    skierX = course.centerAt(0);
    skierY = 0;
    vx = 0; speed = 0; mode = 'down'; straightFor = 0; heading = 'down';
    held = []; tapLeft = 0;
    hitWhat = 'TREES'; exploded = new Set(); scorched = new Map(); particles = [];
    animals = []; animalSlot = Math.ceil(START_PAD / ANIMAL_SLOT);
    birds = []; birdIn = between(course.endless ? BIRD_EVERY_ENDLESS : BIRD_EVERY);
    passed = 0; missed = 0; reds = 0; clips = 0; nextPole = 0;
    streak = 0; streaks = []; clipPoints = 0; burned = { pine: 0, tree: 0, fence: 0 };
    survived = { fox: 0, wolf: 0, bear: 0 };
    shownBonus = 0;
    runEnd = null;
    pausedMs = 0;
    paintHud();
    // 3, 2, 1 with the skier standing at the top, then GO. Neither clock
    // starts until GO.
    msgEl.classList.add('above-count');
    flash("GOOD LUCK, YOU'RE GONNA NEED IT", 3 * COUNT_BEAT_MS);
    state = 'countdown';
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
    SFX.startSwoosh();
    SFX.playCount(true);
    showCount('GO!');
    if (runGod) { flash('GOD MODE'); SFX.playIgnite(); }
    else if (!sessionId) flash('UNRANKED');
    const id = runId;
    setTimeout(() => { if (runId === id) countdownEl.hidden = true; }, 700);
  }

  // R: drop this run, unscored, and go again at once on a new course. The
  // seed is spent with its session, so it can't be the same course.
  function restart() {
    if (state === 'starting') return;
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
    hitWhat = hit.animal ? hit.kind.toUpperCase() : hit.pine ? 'PINEAPPLE' : hit.fence ? 'FENCE' : 'TREES';
    SFX.stopSwoosh();
    if (hit.pine) SFX.playExplosion(); else SFX.playBreak();
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
    if (hit.animal) {   // worth nothing; it just goes up
      animals.splice(animals.indexOf(hit.a), 1);
      const fire = fireColors(runGod);
      SFX.playExplosion();
      spawnExplosion(hit.x, hit.y - 3, [...fire, ...fire, ANIMALS[hit.kind].ink]);
      return;
    }
    const kind = hit.fence ? 'fence' : hit.pine ? 'pine' : 'tree';
    const key = hit.fence ? `f${hit.k},${hit.side}` : hit.i + ',' + hit.j;
    exploded.add(key);
    const fire = fireColors(runGod);
    if (kind === 'tree') scorched.set(key, { at: performance.now(), god: runGod, hit: true });
    if (kind === 'fence') {
      const x = Math.round(hit.x);
      scorched.set(key, { at: performance.now(), god: runGod, gap0: x - 3, gap1: x + 3 });
    }
    burned[kind]++;
    SFX.playExplosion();
    spawnExplosion(hit.x, hit.y - 4, kind === 'tree' ? [...fire, ...fire, ...TREE_PIECES]
      : kind === 'fence' ? [...fire, ...fire, ...FENCE_PIECES] : PIECE_COLORS);
    flash(`${{ pine: 'PINEAPPLE', tree: 'TREE', fence: 'FENCE' }[kind]} +${BURN_POINTS[kind]}`);
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
    while (nextPole < POLE_COUNT) resolvePole(false);
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
    skierY = Math.min(skierY + speed * dt, course.finishY + 12);
    skierX = Math.max(2, Math.min(W - 3, skierX + vx * dt));
  }

  // The camera follows the skier until the finish line is FINISH_ROW down
  // the screen, then holds still and lets the skier run down to it.
  function cameraTop() {
    if (!course) return -SKIER_Y;
    return Math.floor(Math.min(skierY - SKIER_Y, course.finishY - FINISH_ROW));
  }

  // The narrow window's left edge, in world x: centred on the piste a
  // little below the skier, where the eye is, but never letting the skier
  // near the side, and never past the mountain's edges.
  const SIDE_ROOM = 16;
  function cameraLeft(camY) {
    if (!NARROW) return 0;
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
          if (!runGod) SFX.playIgnite();
          const id = runId;
          setTimeout(() => { if (runId === id && streak >= FIRE_AT) flash('YOU ARE ON FIRE !!!'); }, 1000);
        }
      } else endStreak();
      if (said.length) flash(said.join('  '));
    } else {
      endStreak();
      missed++;
      // Brushed on the wrong side is a fork: still a miss, but it says so,
      // and clacks, since on screen it looks a lot like a clip.
      if (clipped) SFX.playClack();
      const what = clipped ? 'FORK  MISS' : 'MISS';
      // The time bonus is lost once, on the miss that loses it. Endless
      // has no clock for a miss to add to.
      flash(course.endless ? what
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
    if ((state === 'title' || state === 'crashed' || state === 'finished') && !boardView) konami(e.key);
    // With the board up, Space or Escape closes it and R restarts.
    if (boardView) {
      if (GO.has(e.key) || e.key === 'Escape') { e.preventDefault(); closeBoard(); }
      else if (e.key === 'r' || e.key === 'R') { e.preventDefault(); closeBoard(); restart(); }
      else if (e.key === 'm' || e.key === 'M') flash(SFX.toggleMute() ? 'SOUND OFF' : 'SOUND ON');
      return;
    }
    if (state === 'title' && (LEFT.has(e.key) || RIGHT.has(e.key))) {
      e.preventDefault();
      if (!e.repeat) chooseMode(modeIndex + (LEFT.has(e.key) ? -1 : 1));
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
    else if (e.key === 'Escape') closeCard();
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
    championship: '12 LEGENDARY MOUNTAINS, ONE CHAMPION.<br>CAN YOU CONQUER THE NORTH FACE OF EVEREST?',
    endless: 'NO FINISH LINE. HOW FAR CAN YOU GO?<br>A CRASH OR 4 MISSES AND IT\'S OVER.',
  };
  const modeBtns = [...document.querySelectorAll('.mode-btn')];
  const modeTextEl = document.getElementById('mode-text');
  let modeIndex = 0;
  function chooseMode(i) {
    modeIndex = (i + modeBtns.length) % modeBtns.length;
    modeBtns.forEach((b, k) => b.classList.toggle('chosen', k === modeIndex));
    modeTextEl.innerHTML = MODE_TEXT[modeBtns[modeIndex].dataset.mode];
    paintHud();
    if (!leaderboardCache[currentBoard()]) fetchLeaderboard();
  }
  const chosenMode = () => modeBtns[modeIndex].dataset.mode;
  function startChosen() {
    if (chosenMode() === 'championship') flash('COMING SOON');
    else startRun();
  }
  modeBtns.forEach((btn, i) => btn.addEventListener('click', () => {
    btn.blur();
    if (state !== 'title') return;
    chooseMode(i);
    startChosen();
  }));

  // Space, or a tap on the screen: start, pause and resume, skip the tally.
  function spaceAction() {
    if (state === 'title') startChosen();
    else if (state === 'running' || state === 'paused') togglePause();
    else if (tally) endTally();
    else if ((overlayEl.hidden === false || cardClosed) && (state === 'crashed' || state === 'finished')) toTitle();
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
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    SFX.unlock();
    if (nearArrow(e.clientX, e.clientY) || state === 'title') return;   // on the title, tap a mode
    spaceAction();
  });
  arrowBtns.forEach((btn) => {
    const dir = btn.dataset.dir;
    const id = 'b' + dir;
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      SFX.unlock();
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

    const hit = hitTree(skierX, skierY) || hitFence(skierX, skierY) || hitAnimal(skierX, skierY);
    if (hit && onFire()) burn(hit);
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
    const target = DOWN_SPEED * tuck * (1 - DEEP_SNOW_DRAG * depth);
    const rate = target > speed ? ACCEL_RATE : DECEL_RATE;
    speed += (target - speed) * Math.min(1, dt * rate);

    const targetVx = heading === 'left' ? -LATERAL : heading === 'right' ? LATERAL : 0;
    vx += (targetVx - vx) * Math.min(1, dt * 10);

    skierY += speed * dt;
    skierX = Math.max(2, Math.min(W - 3, skierX + vx * dt));

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
    if (skierY >= course.finishY) finish();
  }

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
        if (!tr || tr.pine) continue;
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
    const hw = PATH_HW + noise2(y / 22, left ? 3.5 : 9.5) * EDGE_WOBBLE;
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
    const x = i * TREE_CELL + 2 + Math.floor(hash(i * 7 + salt, j * 3 + 1) * (TREE_CELL - 4));
    const y = j * TREE_CELL + 2 + Math.floor(hash(i * 5 + salt, j * 11 + 7) * (TREE_CELL - 4));
    if (course && Math.abs(x - course.titlePine.x) < 10 && Math.abs(y - course.titlePine.y) < 12) return null;
    const depth = snowDepth(x, centerAt(y), y);
    // Endless puts more on the piste the harder it gets.
    const crowd = course && course.endless ? 1 + 2 * course.levelAt(y) : 1;
    const pineChance = depth <= 0 ? PINE_CHANCE * PINE_PISTE * crowd : PINE_CHANCE;
    const pine = hash(i * 48271 + salt, j * 13 + 5) < pineChance && pineIsFair(x, y);
    if (pine) {
      // Anywhere at all, so no tree chance to pass.
    } else if (depth <= 0) {
      // The odd tree on the piste itself, never on the racing line.
      if (hash(i * 92821 + salt, j) >= PISTE_TREE || !lineIsClear(x, y)) return null;
    } else {
      const chance = TREE_EDGE + (TREE_MAX - TREE_EDGE) * depth;
      if (hash(i * 92821 + salt, j) >= chance) return null;
    }
    // Keep clear of fences, so the two never overlap.
    const side = x < centerAt(y) ? -1 : 1, k = Math.floor(y / FENCE_SLOT);
    for (let kk = k - 1; kk <= k + 1; kk++) {
      const f = fenceAt(kk, side, salt, centerAt);
      if (f && Math.abs(y - f.y) <= 10 && x >= f.x0 - 5 && x <= f.x1 + 5) return null;
    }
    return { i, j, x, y, pine };
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
    if (hash(k * 613 + salt, side + 71) >= FENCE_CHANCE) return null;
    const y = k * FENCE_SLOT + Math.floor(hash(k * 37 + salt, side + 5) * (FENCE_SLOT - 8));
    const c = centerAt(y);
    const len = 16 + Math.floor(hash(k * 91 + salt, side + 13) * 22);
    let a;
    const intrude = INTRUDE_CHANCE * (course && course.endless ? 1 + course.levelAt(y) : 1);
    if (course && hash(k * 17 + salt, side + 41) < intrude) {
      a = Math.round(c + side * (PATH_HW - 4 - hash(k * 23 + salt, side + 3) * (INTRUDE_MAX - 4)));
      // The line runs inside the piste edge, so backing out reaches clear.
      while (!lineIsClear(a, y) && Math.abs(a - c) < PATH_HW + EDGE_WOBBLE) a += side;
    } else {
      const edge = c + side * (PATH_HW + EDGE_WOBBLE);
      const room = side < 0 ? edge : W - edge;
      if (room < len + 8) return null;
      a = Math.round(edge + side * (4 + Math.floor(hash(k * 53 + salt, side + 29) * (room - len - 4))));
    }
    const b = Math.max(0, Math.min(W - 1, a + side * len));
    return { y, x0: Math.min(a, b), x1: Math.max(a, b) };
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
    const { salt, centerAt, endless } = course;
    if (hash(k * 719 + salt, side + 83) >= (endless ? ANIMAL_ODDS_ENDLESS : ANIMAL_ODDS)) return null;
    const y = k * ANIMAL_SLOT + Math.floor(hash(k * 41 + salt, side + 7) * (ANIMAL_SLOT - 20));
    const x = Math.round(centerAt(y) + side * (PATH_HW + 6 + hash(k * 59 + salt, side + 19) * 14));
    if (x < 10 || x > W - 10 || y > course.finishY - 40) return null;
    if (Math.abs(x - course.lineAt(y)) < CLEAR_LINE + ANIMAL_ROAM) return null;
    const roll = hash(k * 137 + salt, side + 53);
    return { kind: roll < 0.67 ? 'fox' : roll < 0.92 ? 'wolf' : 'bear', x, y, homeX: x, homeY: y,
      mode: 'pause', t: Math.random() * 2, face: side, toX: x, toY: y };
  }

  // Worth more the rarer the animal; also in slalom_submit.
  function survivedChase(a) {
    survived[a.kind]++;
    flash(`SURVIVED ${a.kind.toUpperCase()} CHASE !!! +${ANIMALS[a.kind].bonus}`);
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

  function hitAnimal(x, y) {
    for (const a of animals) {
      const k = ANIMALS[a.kind];
      if (a.tame || (a.mode === 'chase' && a.kind !== 'bear')) continue;
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
      const rows = a.mode === 'walk' || a.mode === 'chase'
        ? k.walk[Math.floor(performance.now() / (a.mode === 'chase' ? 80 : 160)) % 2] : k.stand;
      const flip = a.face < 0 ? rows.map(r => r.split('').reverse().join('')) : rows;
      blit(flip, Math.round(a.x) - (rows[0].length >> 1), Math.round(a.y) - camY - rows.length + 1, k.ink);
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

  // A fence occupies rows y-4..y; the skier is fenced in when any of the
  // skier's rows meet it, give or take a pixel.
  function hitFence(x, y) {
    const { salt, centerAt } = course;
    const k0 = Math.floor((y - 10) / FENCE_SLOT), k1 = Math.floor((y + 10) / FENCE_SLOT);
    for (let k = k0; k <= k1; k++) {
      for (const side of [-1, 1]) {
        const f = fenceAt(k, side, salt, centerAt);
        if (f && !exploded.has(`f${k},${side}`) && y >= f.y - 7 && y <= f.y + 1 && x >= f.x0 - 2 && x <= f.x1 + 2) {
          return { fence: true, k, side, x, y: f.y };
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
        const reach = tr.pine ? 3 : 5, top = tr.pine ? 8 : 10;
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
  const INKS = { O: VIC.orange, G: VIC.green, Y: VIC.yellow, R: VIC.red,
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
  const RESTART_ICON = [      // snake's R, moved a column right to sit centred
    '........',
    '..YYYY..',
    '..Y..Y..',
    '..Y..Y..',
    '..YYYY..',
    '..Y.Y...',
    '..Y..Y..',
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
  paintIcon(restartBtnEl, RESTART_ICON);
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
    const x0 = tr.x - 4, y0 = tr.y - camY - 8;
    if (sc.hit) {
      put(tr.x, y0 + 8, VIC.black); put(tr.x, y0 + 7, VIC.black);
      put(tr.x - 1, y0 + 8, VIC.black); put(tr.x + 1, y0 + 8, VIC.black);
      return;
    }
    const age = performance.now() - sc.at, frame = Math.floor(performance.now() / 90);
    const colors = fireColors(sc.god);
    for (let r = 0; r < TREE.length; r++) {
      for (let c = 0; c < TREE[r].length; c++) {
        if (TREE[r][c] === '.') continue;
        if (age < POLE_BURN_MS) put(x0 + c, y0 + r, colors[Math.floor(hash(c * 31 + r, frame + tr.x) * 3)]);
        else if (TREE[r][c] === 'O' || hash(tr.x * 13 + c, tr.y + r) > 0.35) put(x0 + c, y0 + r, VIC.black);
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

  // A row of slope always looks the same, so each one is computed once, on
  // the frame it scrolls into view, and copied after that. Most frames only
  // build a row or two; the noise is the expensive part.
  const snowRows = new Map();
  const titleCenter = () => W / 2;

  function snowRow(wy, centerAt, lineAt) {
    let row = snowRows.get(wy);
    if (row) return row;
    row = new Uint8ClampedArray(W * 4);
    const c = centerAt(wy);
    const line = lineAt ? lineAt(wy) : null;
    for (let sx = 0; sx < W; sx++) {
      let col = VIC.white;
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
        const density = depth > 0.92 ? 1 : Math.max(0, 0.7 * depth ** 2 + drift);
        if (hash(sx, wy) < density) col = VIC.lightBlue;
      } else if (hash(sx + 4441, wy + 17) < 0.005) {
        col = VIC.lightBlue;   // a stray speck, so the piste isn't spotless
      }
      const i = sx * 4;
      row[i] = col[0]; row[i + 1] = col[1]; row[i + 2] = col[2]; row[i + 3] = 255;
    }
    snowRows.set(wy, row);
    if (snowRows.size > H * 3) {
      for (const k of snowRows.keys()) if (Math.abs(k - wy) > H * 2) snowRows.delete(k);
    }
    return row;
  }

  function render() {
    const camY = cameraTop();
    camX = cameraLeft(camY);
    const centerAt = course ? course.centerAt : titleCenter;

    const lineAt = course ? course.lineAt : null;
    for (let sy = 0; sy < H; sy++) {
      img.data.set(snowRow(camY + sy, centerAt, lineAt).subarray(camX * 4, (camX + VW) * 4), sy * VW * 4);
    }

    // Trees, scattered off the piste and thickening toward the edges.
    const salt = course ? course.salt : 0;
    const j0 = Math.floor(camY / TREE_CELL) - 1;
    const j1 = Math.floor((camY + H) / TREE_CELL) + 1;
    const iMax = Math.ceil(W / TREE_CELL);
    for (let j = j0; j <= j1; j++) {
      for (let i = 0; i < iMax; i++) {
        const tr = treeAt(i, j, salt, centerAt);
        if (!tr) continue;
        const sc = scorched.get(i + ',' + j);
        if (sc) drawScorchedTree(tr, sc, camY);
        else if (exploded.has(i + ',' + j)) continue;
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

    if (course) {
      for (const p of course.poles) {
        const sy = p.y - camY;
        if (sy > -4 && sy < H + 10) drawPole(p, sy);
      }
      // Finish line: red/black checker across the piste.
      const fy = course.finishY - camY;
      if (fy > -4 && fy < H + 4) {
        const c = centerAt(course.finishY);
        for (let x = Math.floor(c - PATH_HW); x <= c + PATH_HW; x++) {
          for (let k = 0; k < 4; k++) {
            put(x, fy + k, ((x >> 1) + (k >> 1)) % 2 ? VIC.red : VIC.black);
          }
        }
      }
      if (state !== 'title') {
        drawAnimals(camY);
        const s = SPRITES[mode] || SPRITES.down;
        // Sprites differ in height; they all stand on the same row.
        blit(s, Math.round(skierX) - 3, Math.round(skierY) - camY + 5 - s.length, VIC.black);
        if (onFire() && state !== 'crashed') {
          const frames = runGod ? GOD_FLAMES : FLAMES;
          const fl = frames[Math.floor(performance.now() / 90) % frames.length];
          blit(fl, Math.round(skierX) - 3, Math.round(skierY) - camY + 5 - s.length - 3);
        }
      }
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

    if (course && state !== 'title') drawBirds();
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

  // Each mode keeps its own BEST; the box shows the highlighted mode's on
  // the title and the run's during it.
  const BEST_KEYS = { single: 'slalom_best', endless: 'slalom_best_endless' };
  const best = {};
  for (const m in BEST_KEYS) {
    best[m] = 0;
    try { best[m] = parseInt(localStorage.getItem(BEST_KEYS[m]) || '0', 10) || 0; } catch (_) {}
  }
  const bestMode = () => (state === 'title' ? chosenMode() === 'endless' : course && course.endless) ? 'endless' : 'single';

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
    if (score > best[m]) {
      best[m] = score;
      try { localStorage.setItem(BEST_KEYS[m], score); } catch (_) {}
    }
    bestEl.textContent = best[m];
    placeHudButtons();
  }

  // -------------------------------------------------------------- overlay
  // Two steps, like snake-bit: the run's breakdown and the initials first,
  // then, once saved or skipped, the top 10 with the new entry flashing.
  let lastSubmittedId = null;

  function showOverlay(finished) {
    if (course.endless) SFX.playRunOver();
    overlayWordEl.textContent = finished || ranOut ? 'GAME OVER' : 'WIPEOUT';
    overlayTitleEl.className = 'bad';
    finalScoreEl.textContent = points();
    finalStarsEl.hidden = !finished;
    if (finished) paintCardStars(stars());
    // What happened on the run, never how it was scored: the arithmetic
    // stays in the server's check, not on screen as a recipe.
    breakdownEl.textContent = finished ? `TIME ${fmt(runCs())}` : ranOut ? 'OUT OF MISSES' : `INTO THE ${hitWhat}`;
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
    if (canSave) setTimeout(() => { if (!overlayEl.hidden) initialsInputEl.focus(); }, 450);
    else showBoard(runBoard());
  }

  function hideOverlay() {
    cardClosed = false;
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
  const startPrompt = () => NARROW ? 'TAP TO START' : 'PRESS SPACE';
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
  const boardOf = (endless, god) => (endless ? 'endless' : 'single') + (god ? ':god' : '');
  const currentBoard = () => boardOf(bestMode() === 'endless', godMode);
  const runBoard = () => boardOf(course.endless, runGod);
  const BOARD_TITLE = {
    single: 'TOP 10', 'single:god': 'SECRET GOD MODE<br>TOP 10',
    endless: 'ENDLESS TOP 10', 'endless:god': 'SECRET GOD MODE<br>ENDLESS TOP 10',
  };
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
    boardTitleEl.innerHTML = BOARD_TITLE[board];
    boardTitleEl.classList.toggle('god', board.endsWith(':god'));
    fetchLeaderboard(board);
  }

  async function fetchLeaderboard(board = currentBoard()) {
    const render = board === shownBoard, endless = board.startsWith('endless'), god = board.endsWith(':god');
    if (!juicer) { if (render) leaderboardListEl.innerHTML = placeholder('OFFLINE'); return; }
    if (render && !leaderboardListEl.children.length) leaderboardListEl.innerHTML = placeholder('LOADING...');
    const table = juicer.from(endless ? 'slalom_mode_scores' : god ? 'slalom_god_scores' : 'slalom_scores')
      .select('id, initials, score');
    const { data, error } = await (endless ? table.eq('mode', 'endless').eq('god', god) : table)
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

    const { data, error } = await juicer.rpc(course.endless ? 'slalom_submit_endless' : runGod ? 'slalom_submit_god_score' : 'slalom_submit_score', {
      p_session: sessionId,
      p_payload: {
        initials: raw.padEnd(3, '-'),
        score: points(),
        time_cs: runCs(),
        passed, missed, reds, clips,
        streaks: streak ? [...streaks, streak] : streaks,
        burned,
        survived,
        finished: state === 'finished',
      },
    });
    submitBtnEl.disabled = skipBtnEl.disabled = false;
    if (error) {
      submitStatusEl.textContent = error.message.replace(/^.*?:\s*/, '').toUpperCase();
      submitStatusEl.classList.add('error');
      return;
    }
    submitStatusEl.textContent = "YOU'RE ON THE BOARD!";
    lastSubmittedId = data || null;
    showLeaderboard();
    SFX.playJingle();   // the big moment: your row lights up to this
  });

  skipBtnEl.addEventListener('click', showLeaderboard);
  againBtnEl.addEventListener('click', restart);
  document.getElementById('close-btn').addEventListener('click', closeBoard);
  document.getElementById('card-close-btn').addEventListener('click', (e) => { e.currentTarget.blur(); closeCard(); });
  // Blurred straight away, so Space never "clicks" it again later.
  // A game controller, polled every frame like snake-bit's: the d-pad or
  // left stick turns while held, Start is Space, A is R, B closes the board
  // or the card. Typing initials, A submits and B skips. First pad only.
  let gpDir = null, gpPrev = [];
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
      if (dir && state === 'title') chooseMode(modeIndex + (dir === 'left' ? -1 : 1));
      gpDir = dir;
    }

    if (splashUp) {
      if (justPressed(9) || justPressed(0)) dismissSplash();
    } else if (typing) {
      if (justPressed(0)) submitFormEl.requestSubmit();
      else if (justPressed(1)) showLeaderboard();
    } else if (boardView) {
      if (justPressed(9) || justPressed(1)) closeBoard();
      else if (justPressed(0)) { closeBoard(); restart(); }
    } else {
      if (justPressed(9)) spaceAction();
      else if (justPressed(0)) restart();
      else if (justPressed(1)) closeCard();
    }
    if ([0, 1, 9, 14, 15].some(justPressed)) SFX.unlock();
    gpPrev = pad.buttons.map(b => !!b.pressed);
  }

  boardBtnEl.addEventListener('click', () => { boardBtnEl.blur(); openBoard(); });
  // Pause is Space, restart is R. Blurred like the crown.
  pauseBtnEl.addEventListener('click', () => { pauseBtnEl.blur(); spaceAction(); });
  restartBtnEl.addEventListener('click', () => { restartBtnEl.blur(); restart(); });

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
    if (state === 'running') {
      SFX.updateSwoosh(speed / DOWN_SPEED, snowDepth(skierX, course.centerAt(skierY), skierY), heading !== 'down');
    }
    if (course && state !== 'title' && state !== 'paused' && state !== 'starting') {
      updateAnimals(Math.min(dt, 0.05));
      updateBirds(Math.min(dt, 0.05));
    }
    if (particles.length) updateParticles(Math.min(dt, 0.05));
    if (state === 'running' || state === 'crashed' || state === 'finished') paintHud();
    if (now > flashUntil && state !== 'paused') msgEl.textContent = cardClosed ? startPrompt() : '';
    render();
    requestAnimationFrame(frame);
  }

  prepareRun();
  chooseMode(0);
  if (juicer) setInterval(fetchLeaderboard, 60000);   // keeps makesTop10 current
  requestAnimationFrame(frame);
})();
