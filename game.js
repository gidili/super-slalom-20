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
  const POLE_SPACING = 110;    // world px between poles
  const POLE_OFFSET = 12;      // how far off the piste centre a pole stands
  const CLIP = 3;              // this close to a pole knocks it over
  const START_PAD = 120;
  const FINISH_PAD = 90;
  const PATH_HW = 28;          // groomed piste, half width

  // Off the piste, "depth" runs from 0 at the piste edge to 1 at the screen
  // edge on that side. It drives the light-blue speckle, the drag, and how
  // likely a tree is, so what you see is what slows you.
  const TREE_CELL = 12;        // trees are placed at most one per cell
  const TREE_CLEAR = 0.3;      // no trees at all this close to the piste
  const TREE_MAX = 0.6;        // chance of a tree per cell at the screen edge

  const SKIER_Y = 48;          // skier's fixed screen row
  const DOWN_SPEED = 72;       // px/s straight down on the piste
  const CARVE_FACTOR = 0.82;   // steering costs a little speed
  const TUCK_BONUS = 0.12;     // extra speed after holding a straight line...
  const TUCK_RAMP = 1.2;       // ...reached over this many seconds
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
  function pickRedPoles(seed) {
    const rnd = mulberry32((seed % 4294967296) ^ 0x5EED);
    const idx = Array.from({ length: POLE_COUNT }, (_, i) => i);
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
    const first = rnd() < 0.5 ? -1 : 1;
    const poles = [];
    for (let i = 0; i < POLE_COUNT; i++) {
      const y = START_PAD + i * POLE_SPACING;
      const side = i % 2 === 0 ? first : -first;
      const x = Math.round(centerAt(y) + side * (POLE_OFFSET + rnd() * 4));
      // fallen: 0 standing, else the direction it fell (-1 left, 1 right).
      poles.push({ y, x, pass: side, red: redPoles.has(i), result: null, fallen: 0 });
    }
    const finishY = START_PAD + (POLE_COUNT - 1) * POLE_SPACING + FINISH_PAD;
    // Mixed into tree placement, so each seed gets its own forest.
    const salt = Math.floor(seed / 4096) % 1000003;
    course = { seed, centerAt, poles, finishY, salt };
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
  // Turn while a key is held, straighten when it's let go. The newest
  // held key wins, and a tap still commits a short turn so it isn't lost.
  let heading = 'down';        // 'left' | 'down' | 'right'
  let held = [];               // [{ id, dir }], newest last
  let tapDir = 'down', tapLeft = 0;

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
    passed = 0; missed = 0; reds = 0; nextPole = 0;
    runEnd = null;
    runStart = performance.now();
    // Physics and clock share an origin; nothing before this moment counts.
    last = runStart;
    acc = 0;
    state = 'running';
    flash(sessionId ? 'GO' : 'GO  (UNRANKED)');
    paintHud();
  }

  function crash() {
    state = 'crashed';
    mode = 'crash';
    runEnd = performance.now();
    closeSession();
    setTimeout(() => showOverlay(false), 900);
  }

  function finish() {
    // Poles not yet resolved can only be ones skipped right before the line.
    while (nextPole < POLE_COUNT) resolvePole(false);
    state = 'finished';
    mode = 'down';
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

  window.addEventListener('keydown', (e) => {
    if (document.activeElement === initialsInputEl) return;
    const id = 'k' + e.key.toLowerCase();
    if (LEFT.has(e.key) || RIGHT.has(e.key)) {
      e.preventDefault();
      if (!e.repeat) press(id, LEFT.has(e.key) ? 'left' : 'right');
    } else if (STRAIGHT.has(e.key)) { straighten(); e.preventDefault(); }
    else if (GO.has(e.key)) {
      e.preventDefault();
      if (state === 'title' || (overlayEl.hidden === false && state !== 'running')) startRun();
    }
  });
  window.addEventListener('keyup', (e) => release('k' + e.key.toLowerCase()));
  // A key let go while the window is unfocused never sends keyup.
  window.addEventListener('blur', straighten);

  // Touch: hold the left third to turn left, the right third to turn
  // right; the middle straightens. Lifting the finger straightens too.
  canvas.addEventListener('touchstart', (e) => {
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
    heading = held.length ? held[held.length - 1].dir : tapLeft > 0 ? tapDir : 'down';
    const steering = heading !== 'down';
    mode = heading;

    if (hitTree(skierX, skierY)) { crash(); return; }

    // Holding a straight line builds a little speed back after a turn;
    // any steering cancels it.
    straightFor = steering ? 0 : straightFor + dt;
    const tuck = steering
      ? CARVE_FACTOR
      : 1 + TUCK_BONUS * Math.min(1, straightFor / TUCK_RAMP);

    // Fresh snow: drag grows with depth, the same depth the speckle shows.
    const depth = snowDepth(skierX, course.centerAt(skierY));
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
  // matter where the piste has wandered.
  function snowDepth(x, center) {
    const d = Math.abs(x - center);
    if (d <= PATH_HW) return 0;
    const span = (x < center ? center : W - center) - PATH_HW;
    return Math.min(1, (d - PATH_HW) / Math.max(1, span));
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
  // you can see is exactly a tree you can hit.
  function treeAt(i, j, salt, centerAt) {
    const x = i * TREE_CELL + 2 + Math.floor(hash(i * 7 + salt, j * 3 + 1) * (TREE_CELL - 4));
    const y = j * TREE_CELL + 2 + Math.floor(hash(i * 5 + salt, j * 11 + 7) * (TREE_CELL - 4));
    const depth = snowDepth(x, centerAt(y));
    if (depth < TREE_CLEAR) return null;
    const chance = TREE_MAX * ((depth - TREE_CLEAR) / (1 - TREE_CLEAR)) ** 1.5;
    return hash(i * 92821 + salt, j) < chance ? { x, y } : null;
  }

  // Skier rows span y-4..y+4, a tree's y-6..y. A pixel or so of mercy on
  // each edge, so a brush past the canopy doesn't end the run.
  function hitTree(x, y) {
    const { salt, centerAt } = course;
    const i0 = Math.floor((x - 8) / TREE_CELL), i1 = Math.floor((x + 8) / TREE_CELL);
    const j0 = Math.floor((y - 8) / TREE_CELL), j1 = Math.floor((y + 12) / TREE_CELL);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const tr = treeAt(i, j, salt, centerAt);
        if (tr && Math.abs(x - tr.x) <= 4 && y >= tr.y - 8 && y <= tr.y + 2) return true;
      }
    }
    return false;
  }

  function put(x, y, c) {
    if (x < 0 || x >= W || y < 0 || y >= H) return;
    const i = (y * W + x) * 4;
    img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = 255;
  }

  // 1 = ink. Each 7 wide, drawn centred on the skier.
  const SPRITES = {
    down: [
      '...X...',
      '..XXX..',
      '...X...',
      '.XXXXX.',
      'X.XXX.X',
      '..X.X..',
      '..X.X..',
      '..X.X..',
      '..X.X..',
    ],
    right: [
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
  SPRITES.left = SPRITES.right.map(r => r.split('').reverse().join(''));

  const TREE = [
    '...X...',
    '..XXX..',
    '.XXXXX.',
    '..XXX..',
    '.XXXXX.',
    'XXXXXXX',
    '...O...',
  ];

  function blit(rows, x0, y0, ink) {
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < rows[r].length; c++) {
        const ch = rows[r][c];
        if (ch === 'X') put(x0 + c, y0 + r, ink);
        else if (ch === 'O') put(x0 + c, y0 + r, VIC.orange);
      }
    }
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

  function snowRow(wy, centerAt) {
    let row = snowRows.get(wy);
    if (row) return row;
    row = new Uint8ClampedArray(W * 4);
    const c = centerAt(wy);
    for (let sx = 0; sx < W; sx++) {
      let col = VIC.white;
      const depth = snowDepth(sx, c);
      if (depth > 0) {
        // Light blue speckle: rises gently with depth, pushed around by
        // drift noise that fades out as depth reaches 1, so the margin
        // still ends solid blue.
        const drift = (noise2(sx / 13, wy / 13) - 0.5) * 0.7 * (1 - depth);
        const density = Math.max(0, Math.min(1, depth ** 1.25 + drift));
        if (hash(sx, wy) < density) col = VIC.lightBlue;
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

    for (let sy = 0; sy < H; sy++) img.data.set(snowRow(camY + sy, centerAt), sy * W * 4);

    // Trees, scattered off the piste and thickening toward the edges.
    const salt = course ? course.salt : 0;
    const j0 = Math.floor(camY / TREE_CELL) - 1;
    const j1 = Math.floor((camY + H) / TREE_CELL) + 1;
    const iMax = Math.ceil(W / TREE_CELL);
    for (let j = j0; j <= j1; j++) {
      for (let i = 0; i < iMax; i++) {
        const tr = treeAt(i, j, salt, centerAt);
        if (tr) blit(TREE, tr.x - 3, tr.y - camY - 6, VIC.green);
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
        blit(s, Math.round(skierX) - 3, SKIER_Y - 4, VIC.black);
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
      breakdownEl.innerHTML = '<div class="center">INTO THE TREES. NO TIME.</div>';
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
  againBtnEl.addEventListener('click', startRun);

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
