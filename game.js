(() => {
  'use strict';

  // ------------------------------------------------------------- the screen
  // An old 4:3 TV, filled with snow edge to edge: 28 x 21 characters of
  // 8 x 8 pixels. Wider than the VIC-20's stock 22 columns, to leave room
  // off the piste for shortcuts.
  const W = 224, H = 168;

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
  // POLE_COUNT, RED_COUNT, MALUS_CS and BONUS_CS are also hard-coded in
  // slalom_submit_score, which recomputes the final time and rejects any
  // that disagrees. Change both or neither.
  const POLE_COUNT = 20;
  const RED_COUNT = 4;         // every course has exactly this many red poles
  const MALUS_CS = 300;        // missed pole: +3.00s
  const BONUS_CS = 150;        // red pole cleared: -1.50s

  // One pole per turn, real-slalom style: the flag points to the side you
  // pass on, and the sides alternate down the course.
  // The gaps shrink down the course, so the end is the hard part.
  const POLE_GAP_FIRST = 95;   // world px between the first two poles
  const POLE_GAP_LAST = 65;    // ...and the last two
  const POLE_OFFSET = 12;      // how far off the piste centre a pole stands
  const CLIP = 3;              // this close to a pole knocks it over
  const LINE_WIDE = 6;         // the worn line passes this far outside a pole
  const LINE_HW = 3;           // ...and is this wide either side
  const START_PAD = 120;
  const FINISH_PAD = 90;
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
  // Tuned for about 3-4 pineapples a run, nearly all close to the piste.
  const PINE_ZONE = 0.4;       // "near the piste": depth below this
  const PINE_NEAR = 1 / 50;
  const PINE_FAR = 1 / 1000;

  const SKIER_Y = 48;          // skier's fixed screen row
  const DOWN_SPEED = 72;       // px/s straight down on the piste
  const CARVE_FACTOR = 0.82;   // steering costs a little speed
  const TUCK_BONUS = 0.25;     // extra speed after holding a straight line...
  const TUCK_RAMP = 0.9;       // ...reached over this many seconds
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

  let course = null;

  function buildCourse(seed) {
    const redPoles = pickRedPoles(seed);
    const rnd = mulberry32(seed % 4294967296);
    const f1 = 0.006 + rnd() * 0.004, p1 = rnd() * Math.PI * 2;
    const f2 = 0.017 + rnd() * 0.008, p2 = rnd() * Math.PI * 2;
    const centerAt = y => W / 2 + 18 * Math.sin(y * f1 + p1) + 10 * Math.sin(y * f2 + p2);

    // The seed picks the first pole's side; after that they alternate, so
    // the line is a slalom, not a schuss. Each pole is passed on its
    // outside, away from the piste centre, which is what makes you weave.
    // The first pole has no flag and counts on either side, so starting
    // against the line is fine; the rest of the course doesn't change.
    const first = rnd() < 0.5 ? -1 : 1;
    const poles = [];
    let y = START_PAD;
    for (let i = 0; i < POLE_COUNT; i++) {
      if (i > 0) y += POLE_GAP_FIRST + (POLE_GAP_LAST - POLE_GAP_FIRST) * (i - 1) / (POLE_COUNT - 2);
      y = Math.round(y);
      const side = i % 2 === 0 ? first : -first;
      const x = Math.round(centerAt(y) + side * (POLE_OFFSET + rnd() * 4));
      // pass: side to pass on, 0 = either. fallen: 0 standing, else the
      // direction it fell (-1 left, 1 right).
      poles.push({ y, x, side, pass: i === 0 ? 0 : side, red: redPoles.has(i), result: null, fallen: 0 });
    }
    const finishY = y + FINISH_PAD;

    // The racing line: start at the top of the piste, swing past each pole
    // just outside it, end mid-piste at the finish. Drawn as a worn track
    // in the snow.
    const pts = [{ y: 0, x: centerAt(0) }]
      .concat(poles.map(p => ({ y: p.y, x: p.x + p.side * LINE_WIDE })))
      .concat([{ y: finishY, x: centerAt(finishY) }]);
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
    course = { seed, centerAt, lineAt, poles, finishY, salt };
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
  canvas.width = W; canvas.height = H;
  const img = ctx.createImageData(W, H);

  const timeEl = document.getElementById('hud-time');
  const poleEl = document.getElementById('hud-pole');
  const missEl = document.getElementById('hud-miss');
  const redEl = document.getElementById('hud-red');
  const msgEl = document.getElementById('message');
  const overlayEl = document.getElementById('overlay');
  const overlayTitleEl = document.getElementById('overlay-title');
  const breakdownEl = document.getElementById('breakdown');
  const submitFormEl = document.getElementById('submit-form');
  const initialsInputEl = document.getElementById('initials-input');
  const submitBtnEl = document.getElementById('submit-btn');
  const skipBtnEl = document.getElementById('skip-btn');
  const submitStatusEl = document.getElementById('submit-status');
  const leaderboardListEl = document.getElementById('leaderboard-list');
  const againBtnEl = document.getElementById('again-btn');
  const titleCardEl = document.getElementById('title-card');

  // ------------------------------------------------------------ run state
  // 'title' -> 'starting' -> 'running' -> 'crashed' | 'finished'
  let state = 'title';
  let skierX, skierY, vx, speed, mode;
  let straightFor = 0;         // seconds since the skier last steered
  let passed, missed, reds, nextPole;
  let runStart = 0, runEnd = null;
  let hitWhat = 'TREES';       // what ended a crashed run, for the card
  let exploded = new Set();    // pineapples already blown up, by cell
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
    // follow speed; deep snow muffles it.
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
      const v = Math.max(0, Math.min(1.2, speedNorm));
      swoosh.g.gain.setTargetAtTime(0.04 + 0.12 * v + (steering ? 0.04 : 0), t, 0.06);
      swoosh.f.frequency.setTargetAtTime(500 + 2600 * v * (1 - 0.65 * depth), t, 0.06);
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
      playExplosion: safe(playExplosion), toggleMute: safe(toggleMute),
    };
  })();

  // --------------------------------------------------------- session edges
  // Unlike snake-bit, the session opens when the run starts, not on page
  // load: the course needs the server's seed before it exists. A side
  // effect is that idle page loads no longer leave orphan sessions.
  let sessionId = null, endPromise = null;

  async function openSession() {
    sessionId = null;
    endPromise = null;
    if (juicer) {
      try {
        const { data, error } = await juicer.rpc('slalom_start_game');
        if (!error && data && data.session) {
          sessionId = data.session;
          return Number(data.seed);
        }
      } catch (_) { /* fall through to an unranked run */ }
    }
    return Math.floor(Math.random() * 2 ** 40);
  }

  function closeSession() {
    if (!juicer || !sessionId) return;
    const id = sessionId;
    endPromise = juicer.rpc('slalom_end_game', { p_session: id })
      .then(() => {}, () => {});
  }

  // Frozen at the end of the run. In snake-bit this once ran until submit,
  // so the reported time silently absorbed initials-typing time.
  const runCs = () =>
    Math.round(((runEnd !== null ? runEnd : performance.now()) - runStart) / 10);

  const finalCs = () => runCs() + missed * MALUS_CS - reds * BONUS_CS;

  const fmt = cs => {
    const neg = cs < 0; cs = Math.abs(cs);
    return (neg ? '-' : '') + Math.floor(cs / 100) + '.' + String(cs % 100).padStart(2, '0');
  };

  // ---------------------------------------------------------------- flow
  // After a run, back to an empty slope that waits for Space. The session
  // still opens on that press, not here: its clock must not include the
  // time spent waiting.
  function toTitle() {
    state = 'title';
    course = null;
    particles = [];
    snowRows.clear();
    overlayEl.hidden = true;
    passed = 0; missed = 0; reds = 0; nextPole = 0;
    msgEl.textContent = 'PRESS SPACE';
    paintHud();
  }

  async function startRun() {
    if (state === 'starting' || state === 'running') return;
    state = 'starting';
    overlayEl.hidden = true;
    titleCardEl.hidden = true;
    flash('GET READY');
    const seed = await openSession();
    buildCourse(seed);
    skierX = course.centerAt(0);
    skierY = 0;
    vx = 0; speed = 0; mode = 'down'; straightFor = 0; heading = 'down';
    held = []; tapLeft = 0;
    hitWhat = 'TREES'; exploded = new Set(); particles = [];
    passed = 0; missed = 0; reds = 0; nextPole = 0;
    runEnd = null;
    runStart = performance.now();
    // Physics and clock share an origin; nothing before this moment counts.
    last = runStart;
    acc = 0;
    state = 'running';
    SFX.startSwoosh();
    flash(sessionId ? 'GO' : 'GO  (UNRANKED)');
    paintHud();
  }

  function crash(hit) {
    state = 'crashed';
    mode = 'crash';
    runEnd = performance.now();
    hitWhat = hit.pine ? 'PINEAPPLE' : hit.fence ? 'FENCE' : 'TREES';
    SFX.stopSwoosh();
    if (hit.pine) SFX.playExplosion(); else SFX.playBreak();
    if (hit.pine) {
      exploded.add(hit.i + ',' + hit.j);
      spawnExplosion(hit.x, hit.y - 3);
    }
    closeSession();
    // Long enough to watch the pieces land.
    setTimeout(() => showOverlay(false), hit.pine ? 1400 : 900);
  }

  function finish() {
    // Poles not yet resolved can only be ones skipped right before the line.
    while (nextPole < POLE_COUNT) resolvePole(false);
    state = 'finished';
    mode = 'down';
    SFX.stopSwoosh();
    runEnd = performance.now();
    closeSession();
    setTimeout(() => showOverlay(true), 500);
  }

  function resolvePole(through) {
    const p = course.poles[nextPole];
    p.result = through ? 'pass' : 'miss';
    if (through) {
      passed++;
      if (p.red) { reds++; flash('RED  -1.50'); }
    } else {
      missed++;
      flash('MISS +3.00');
    }
    nextPole++;
    paintHud();
  }

  // ----------------------------------------------------------------- input
  const LEFT = new Set(['ArrowLeft', 'a', 'A', '4']);
  const RIGHT = new Set(['ArrowRight', 'd', 'D', '6']);
  const STRAIGHT = new Set(['ArrowDown', 's', 'S', '2']);
  const GO = new Set([' ', 'Enter']);

  function press(id, dir) {
    held = held.filter(h => h.id !== id);
    held.push({ id, dir });
    tapDir = dir; tapLeft = MIN_TURN;
  }
  function release(id) { held = held.filter(h => h.id !== id); }
  function straighten() { held = []; tapLeft = 0; }

  // Any first key, tap or click lets the page make sound.
  window.addEventListener('pointerdown', SFX.unlock);

  window.addEventListener('keydown', (e) => {
    SFX.unlock();
    if (document.activeElement === initialsInputEl) return;
    const id = 'k' + e.key.toLowerCase();
    if (LEFT.has(e.key) || RIGHT.has(e.key)) {
      e.preventDefault();
      if (!e.repeat) press(id, LEFT.has(e.key) ? 'left' : 'right');
    } else if (STRAIGHT.has(e.key)) { straighten(); e.preventDefault(); }
    else if (e.key === 'm' || e.key === 'M') flash(SFX.toggleMute() ? 'SOUND OFF' : 'SOUND ON');
    else if (GO.has(e.key)) {
      e.preventDefault();
      if (state === 'title') startRun();
      else if (overlayEl.hidden === false && (state === 'crashed' || state === 'finished')) toTitle();
    }
  });
  window.addEventListener('keyup', (e) => release('k' + e.key.toLowerCase()));
  // A key let go while the window is unfocused never sends keyup.
  window.addEventListener('blur', straighten);

  // Touch: hold the left third to turn left, the right third to turn
  // right; the middle straightens. Lifting the finger straightens too.
  canvas.addEventListener('touchstart', (e) => {
    SFX.unlock();
    if (state === 'title') { startRun(); return; }
    const r = canvas.getBoundingClientRect();
    for (const t of e.changedTouches) {
      const f = (t.clientX - r.left) / r.width;
      if (f < 1 / 3) press('t' + t.identifier, 'left');
      else if (f > 2 / 3) press('t' + t.identifier, 'right');
      else straighten();
    }
  }, { passive: true });
  const lift = (e) => { for (const t of e.changedTouches) release('t' + t.identifier); };
  canvas.addEventListener('touchend', lift, { passive: true });
  canvas.addEventListener('touchcancel', lift, { passive: true });

  // --------------------------------------------------------------- physics
  function step(dt) {
    tapLeft = Math.max(0, tapLeft - dt);
    const was = heading;
    heading = held.length ? held[held.length - 1].dir : tapLeft > 0 ? tapDir : 'down';
    // Every change of direction snaps; straightening up a little softer.
    if (heading !== was) SFX.playDash(heading === 'down' ? 0.5 : 1);
    const steering = heading !== 'down';
    mode = heading;

    const hit = hitTree(skierX, skierY) || hitFence(skierX, skierY);
    if (hit) { crash(hit); return; }

    // Holding a straight line builds a little speed back after a turn;
    // any steering cancels it.
    straightFor = steering ? 0 : straightFor + dt;
    const tuck = steering
      ? CARVE_FACTOR
      : 1 + TUCK_BONUS * Math.min(1, straightFor / TUCK_RAMP);

    // Fresh snow: drag grows with depth, the same depth the speckle shows.
    const depth = snowDepth(skierX, course.centerAt(skierY), skierY);
    const target = DOWN_SPEED * tuck * (1 - DEEP_SNOW_DRAG * depth);
    const rate = target > speed ? ACCEL_RATE : DECEL_RATE;
    speed += (target - speed) * Math.min(1, dt * rate);

    const targetVx = heading === 'left' ? -LATERAL : heading === 'right' ? LATERAL : 0;
    vx += (targetVx - vx) * Math.min(1, dt * 10);

    skierY += speed * dt;
    skierX = Math.max(2, Math.min(W - 3, skierX + vx * dt));

    // A pole is cleared when the skier crosses its row on the flag side.
    // Skis that brush it knock it over, which on the right side is fine.
    while (nextPole < POLE_COUNT && course.poles[nextPole].y <= skierY) {
      const p = course.poles[nextPole];
      if (Math.abs(skierX - p.x) <= CLIP) p.fallen = skierX < p.x ? 1 : -1;
      resolvePole((skierX - p.x) * p.pass >= 0);
    }

    if (skierY >= course.finishY) finish();
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
  // you can see is exactly a tree you can hit. Now and then the tree is a
  // pineapple, which is just as solid and a lot louder.
  function treeAt(i, j, salt, centerAt) {
    const x = i * TREE_CELL + 2 + Math.floor(hash(i * 7 + salt, j * 3 + 1) * (TREE_CELL - 4));
    const y = j * TREE_CELL + 2 + Math.floor(hash(i * 5 + salt, j * 11 + 7) * (TREE_CELL - 4));
    const depth = snowDepth(x, centerAt(y), y);
    if (depth <= 0) return null;
    const chance = TREE_EDGE + (TREE_MAX - TREE_EDGE) * depth;
    if (hash(i * 92821 + salt, j) >= chance) return null;
    // Keep clear of fences, so the two never overlap.
    const side = x < centerAt(y) ? -1 : 1, k = Math.floor(y / FENCE_SLOT);
    for (let kk = k - 1; kk <= k + 1; kk++) {
      const f = fenceAt(kk, side, salt, centerAt);
      if (f && Math.abs(y - f.y) <= 8 && x >= f.x0 - 4 && x <= f.x1 + 4) return null;
    }
    // Pineapples mostly turn up in the sparse trees near the piste, where
    // they can be seen, rarely in the thick of the forest.
    const pine = hash(i * 48271 + salt, j * 13 + 5) < (depth < PINE_ZONE ? PINE_NEAR : PINE_FAR);
    return { i, j, x, y, pine };
  }

  // A fence piece lying across the fresh snow on one side of the piste:
  // world row y, from x0 to x1. Placed by hash per slot, like the trees.
  function fenceAt(k, side, salt, centerAt) {
    if (hash(k * 613 + salt, side + 71) >= FENCE_CHANCE) return null;
    const y = k * FENCE_SLOT + Math.floor(hash(k * 37 + salt, side + 5) * (FENCE_SLOT - 8));
    const edge = centerAt(y) + side * (PATH_HW + EDGE_WOBBLE);
    const room = side < 0 ? edge : W - edge;
    const len = 12 + Math.floor(hash(k * 91 + salt, side + 13) * 18);
    if (room < len + 8) return null;
    const start = 4 + Math.floor(hash(k * 53 + salt, side + 29) * (room - len - 4));
    const a = Math.round(edge + side * start), b = a + side * len;
    return { y, x0: Math.min(a, b), x1: Math.max(a, b) };
  }

  // A fence occupies rows y-2..y; the skier is fenced in when any of the
  // skier's rows meet it, give or take a pixel.
  function hitFence(x, y) {
    const { salt, centerAt } = course;
    const k0 = Math.floor((y - 10) / FENCE_SLOT), k1 = Math.floor((y + 10) / FENCE_SLOT);
    for (let k = k0; k <= k1; k++) {
      for (const side of [-1, 1]) {
        const f = fenceAt(k, side, salt, centerAt);
        if (f && y >= f.y - 5 && y <= f.y + 1 && x >= f.x0 - 2 && x <= f.x1 + 2) return { fence: true };
      }
    }
    return null;
  }

  // Skier rows span y-4..y+4, a tree's y-6..y. A pixel or so of mercy on
  // each edge, so a brush past the canopy doesn't end the run. Returns
  // what was hit, or null.
  function hitTree(x, y) {
    const { salt, centerAt } = course;
    const i0 = Math.floor((x - 8) / TREE_CELL), i1 = Math.floor((x + 8) / TREE_CELL);
    const j0 = Math.floor((y - 8) / TREE_CELL), j1 = Math.floor((y + 12) / TREE_CELL);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const tr = treeAt(i, j, salt, centerAt);
        if (tr && Math.abs(x - tr.x) <= 4 && y >= tr.y - 8 && y <= tr.y + 2) return tr;
      }
    }
    return null;
  }

  function put(x, y, c) {
    if (x < 0 || x >= W || y < 0 || y >= H) return;
    const i = (y * W + x) * 4;
    img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = 255;
  }

  // 1 = ink. Each 7 wide, drawn centred on the skier.
  const SPRITES = {
    // Running straight: tucked, poles trailing back uphill.
    down: [
      'X.....X',
      '.X.X.X.',
      '..XXX..',
      '..XXX..',
      '.X.X.X.',
      '..X.X..',
      '..X.X..',
    ],
    // Turning: skis point the way the skier is heading.
    left: [
      '...X...',
      '..XXX..',
      '...X...',
      '..XXXX.',
      '.X.XX.X',
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
    '...X...',
    '..XXX..',
    '..XXX..',
    '.XXXXX.',
    '.XXXXX.',
    'XXXXXXX',
    '...O...',
  ];

  // snake-bit's pineapple, cut down to tree size in VIC colours.
  const PINEAPPLE = [
    '.G.G.G.',
    '..GGG..',
    '...G...',
    '.YOYOY.',
    'YOYOYOY',
    'OYOYOYO',
    '.YOYOY.',
  ];

  // X takes the ink passed in; the other letters are fixed colours.
  const INKS = { O: VIC.orange, G: VIC.green, Y: VIC.yellow };

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

  function spawnExplosion(x, y) {
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
        color: PIECE_COLORS[Math.floor(Math.random() * PIECE_COLORS.length)],
      });
    }
  }

  function updateParticles(dt) {
    for (const p of particles) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vy += 160 * dt;
      p.life -= dt;
    }
    particles = particles.filter(p => p.life > 0);
  }

  function drawPole(p, sy) {
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
    const camY = Math.floor((course ? skierY : 0) - SKIER_Y);
    const centerAt = course ? course.centerAt : titleCenter;

    const lineAt = course ? course.lineAt : null;
    for (let sy = 0; sy < H; sy++) img.data.set(snowRow(camY + sy, centerAt, lineAt), sy * W * 4);

    // Trees, scattered off the piste and thickening toward the edges.
    const salt = course ? course.salt : 0;
    const j0 = Math.floor(camY / TREE_CELL) - 1;
    const j1 = Math.floor((camY + H) / TREE_CELL) + 1;
    const iMax = Math.ceil(W / TREE_CELL);
    for (let j = j0; j <= j1; j++) {
      for (let i = 0; i < iMax; i++) {
        const tr = treeAt(i, j, salt, centerAt);
        if (!tr) continue;
        if (!tr.pine) blit(TREE, tr.x - 3, tr.y - camY - 6, VIC.green);
        else if (!exploded.has(i + ',' + j)) blit(PINEAPPLE, tr.x - 3, tr.y - camY - 6);
      }
    }

    // Fences: a post every third pixel, a rail between.
    const k0 = Math.floor(camY / FENCE_SLOT) - 1, k1 = Math.floor((camY + H) / FENCE_SLOT) + 1;
    for (let k = k0; k <= k1; k++) {
      for (const side of [-1, 1]) {
        const f = fenceAt(k, side, salt, centerAt);
        if (!f) continue;
        const sy = f.y - camY;
        for (let x = f.x0; x <= f.x1; x++) {
          put(x, sy - 1, VIC.orange);
          if ((x - f.x0) % 3 === 0) { put(x, sy - 2, VIC.orange); put(x, sy, VIC.orange); }
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
        const s = SPRITES[mode] || SPRITES.down;
        // Sprites differ in height; they all stand on the same row.
        blit(s, Math.round(skierX) - 3, SKIER_Y + 5 - s.length, VIC.black);
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

    ctx.putImageData(img, 0, 0);
  }

  // ------------------------------------------------------------------ hud
  let flashUntil = 0;
  function flash(text) {
    msgEl.textContent = text;
    flashUntil = performance.now() + 1100;
  }

  function paintHud() {
    timeEl.textContent = state === 'title' ? '0.00' : fmt(runCs());
    poleEl.textContent = `${Math.min(nextPole || 0, POLE_COUNT)}/${POLE_COUNT}`;
    missEl.textContent = missed || 0;
    redEl.textContent = reds || 0;
  }

  // -------------------------------------------------------------- overlay
  function showOverlay(finished) {
    overlayTitleEl.textContent = finished ? 'FINISH' : 'WIPEOUT';
    overlayTitleEl.className = finished ? 'ok' : 'bad';
    if (finished) {
      breakdownEl.innerHTML =
        `<div><span>RUN</span><span>${fmt(runCs())}</span></div>` +
        `<div><span>MISSED ${missed} x 3.00</span><span>+${fmt(missed * MALUS_CS)}</span></div>` +
        `<div><span>RED ${reds} x 1.50</span><span>-${fmt(reds * BONUS_CS)}</span></div>` +
        `<div class="total"><span>TIME</span><span>${fmt(finalCs())}</span></div>`;
    } else {
      breakdownEl.innerHTML = `<div class="center">INTO THE ${hitWhat}. NO TIME.</div>`;
    }
    // Only a finished, ranked run can be submitted.
    submitFormEl.hidden = !(finished && sessionId);
    submitStatusEl.textContent = finished && !sessionId ? 'UNRANKED RUN' : '';
    submitStatusEl.classList.remove('error');
    try { initialsInputEl.value = localStorage.getItem('slalom_initials') || ''; } catch (_) {}
    overlayEl.hidden = false;
    if (!submitFormEl.hidden) initialsInputEl.focus();
    fetchLeaderboard();
  }

  async function fetchLeaderboard() {
    if (!juicer) { leaderboardListEl.textContent = 'OFFLINE'; return; }
    const { data, error } = await juicer
      .from('slalom_scores')
      .select('id, initials, score')
      .order('score', { ascending: true })        // fastest first
      .order('created_at', { ascending: true })
      .limit(10);
    if (error) { leaderboardListEl.textContent = 'UNAVAILABLE'; return; }
    leaderboardListEl.innerHTML = '';
    if (!data.length) { leaderboardListEl.textContent = 'NO TIMES YET'; return; }
    data.forEach((row, i) => {
      const li = document.createElement('li');
      li.textContent = `${String(i + 1).padStart(2, '0')}  ${row.initials}  ${fmt(row.score).padStart(6, ' ')}`;
      leaderboardListEl.appendChild(li);
    });
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

    const { error } = await juicer.rpc('slalom_submit_score', {
      p_session: sessionId,
      p_payload: {
        initials: raw.padEnd(3, '-'),
        score: finalCs(),
        time_cs: runCs(),
        passed, missed, reds,
      },
    });
    submitBtnEl.disabled = skipBtnEl.disabled = false;
    if (error) {
      submitStatusEl.textContent = error.message.replace(/^.*?:\s*/, '').toUpperCase();
      submitStatusEl.classList.add('error');
      return;
    }
    submitStatusEl.textContent = 'SAVED';
    submitFormEl.hidden = true;
    fetchLeaderboard();
  });

  skipBtnEl.addEventListener('click', () => { submitFormEl.hidden = true; });
  againBtnEl.addEventListener('click', toTitle);

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
    if (state === 'running') {
      acc += dt;
      while (acc >= STEP && state === 'running') { step(STEP); acc -= STEP; }
    } else {
      acc = 0;
    }
    if (state === 'running') {
      SFX.updateSwoosh(speed / DOWN_SPEED, snowDepth(skierX, course.centerAt(skierY), skierY), heading !== 'down');
    }
    if (particles.length) updateParticles(Math.min(dt, 0.05));
    if (state === 'running' || state === 'crashed' || state === 'finished') paintHud();
    if (now > flashUntil && state !== 'title') msgEl.textContent = '';
    render();
    requestAnimationFrame(frame);
  }

  msgEl.textContent = 'PRESS SPACE';
  paintHud();
  fetchLeaderboard();
  requestAnimationFrame(frame);
})();
