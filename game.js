(() => {
  'use strict';

  // ------------------------------------------------------------- the screen
  // VIC-20: 22 x 23 characters of 8 x 8 pixels.
  const W = 176, H = 184;

  // The VIC-20's palette. Nothing outside this list is ever drawn.
  const VIC = {
    black: [0, 0, 0],          white: [255, 255, 255],
    red: [120, 41, 34],        cyan: [135, 214, 221],
    blue: [64, 49, 141],       green: [85, 160, 73],
    orange: [170, 116, 73],    lightBlue: [128, 128, 255],
  };
  const css = c => `rgb(${c[0]},${c[1]},${c[2]})`;

  // ---------------------------------------------------------------- course
  // GATE_COUNT, RED_COUNT, MALUS_CS and BONUS_CS are also hard-coded in
  // slalom_submit_score, which recomputes the final time and rejects any
  // that disagrees. Change both or neither.
  const GATE_COUNT = 20;
  const RED_COUNT = 4;         // every course has exactly this many red gates
  const MALUS_CS = 300;        // missed gate: +3.00s
  const BONUS_CS = 150;        // red gate taken: -1.50s

  const GATE_SPACING = 110;    // world px between gates
  const GATE_HALF = 10;        // half the gap between a gate's two poles
  const START_PAD = 120;
  const FINISH_PAD = 90;
  const PATH_HW = 28;          // groomed piste, half width
  const SNOW_BAND = 22;        // fresh snow between piste and tree line
  const TREE_STEP = 9;

  const SKIER_Y = 48;          // skier's fixed screen row
  const DOWN_SPEED = 72;       // px/s straight down on the piste
  const CARVE_FACTOR = 0.82;   // steering costs a little speed
  const LATERAL = 56;          // px/s sideways while steering
  const DEEP_SNOW_DRAG = 0.65; // speed lost at the very edge of the band

  // The course is deterministic per seed, but the server never rebuilds it:
  // it only checks counts, which are fixed (GATE_COUNT, RED_COUNT). So the
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

  // Exactly RED_COUNT red gates per course, so every run has the same bonus
  // available and the leaderboard measures skiing, not seed luck. Drawn
  // from their own PRNG stream, so tuning the course shape never moves them.
  function pickRedGates(seed) {
    const rnd = mulberry32((seed % 4294967296) ^ 0x5EED);
    const idx = Array.from({ length: GATE_COUNT }, (_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    return new Set(idx.slice(0, RED_COUNT));
  }

  let course = null;

  function buildCourse(seed) {
    const redGates = pickRedGates(seed);
    const rnd = mulberry32(seed % 4294967296);
    const f1 = 0.006 + rnd() * 0.004, p1 = rnd() * Math.PI * 2;
    const f2 = 0.017 + rnd() * 0.008, p2 = rnd() * Math.PI * 2;
    const centerAt = y => W / 2 + 18 * Math.sin(y * f1 + p1) + 10 * Math.sin(y * f2 + p2);

    const gates = [];
    for (let i = 0; i < GATE_COUNT; i++) {
      const y = START_PAD + i * GATE_SPACING;
      // Alternate sides of the piste so the line is a slalom, not a schuss.
      const side = i % 2 === 0 ? -1 : 1;
      const x = Math.round(centerAt(y) + side * (PATH_HW * 0.42 + rnd() * 4));
      gates.push({ y, x, red: redGates.has(i), result: null });
    }
    const finishY = START_PAD + (GATE_COUNT - 1) * GATE_SPACING + FINISH_PAD;
    course = { seed, centerAt, gates, finishY };
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
  const gateEl = document.getElementById('hud-gate');
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

  // ------------------------------------------------------------ run state
  // 'title' -> 'starting' -> 'running' -> 'crashed' | 'finished'
  let state = 'title';
  let skierX, skierY, vx, speed, mode;
  let passed, missed, reds, nextGate;
  let runStart = 0, runEnd = null;
  const held = { left: false, right: false };

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
    flash('GET READY');
    const seed = await openSession();
    buildCourse(seed);
    skierX = course.centerAt(0);
    skierY = 0;
    vx = 0; speed = 0; mode = 'down';
    passed = 0; missed = 0; reds = 0; nextGate = 0;
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
    // Gates not yet resolved can only be ones skipped right before the line.
    while (nextGate < GATE_COUNT) resolveGate(false);
    state = 'finished';
    mode = 'down';
    runEnd = performance.now();
    closeSession();
    setTimeout(() => showOverlay(true), 500);
  }

  function resolveGate(through) {
    const g = course.gates[nextGate];
    g.result = through ? 'pass' : 'miss';
    if (through) {
      passed++;
      if (g.red) { reds++; flash('RED  -1.50'); }
    } else {
      missed++;
      flash('MISS +3.00');
    }
    nextGate++;
    paintHud();
  }

  // ----------------------------------------------------------------- input
  const LEFT = new Set(['ArrowLeft', 'a', 'A', '4']);
  const RIGHT = new Set(['ArrowRight', 'd', 'D', '6']);
  const GO = new Set([' ', 'Enter']);

  window.addEventListener('keydown', (e) => {
    if (document.activeElement === initialsInputEl) return;
    if (LEFT.has(e.key)) { held.left = true; e.preventDefault(); }
    else if (RIGHT.has(e.key)) { held.right = true; e.preventDefault(); }
    else if (GO.has(e.key)) {
      e.preventDefault();
      if (state === 'title' || (overlayEl.hidden === false && state !== 'running')) startRun();
    }
  });
  window.addEventListener('keyup', (e) => {
    if (LEFT.has(e.key)) held.left = false;
    if (RIGHT.has(e.key)) held.right = false;
  });

  // Touch: hold the left or right half of the screen to steer.
  function touchSteer(e) {
    held.left = held.right = false;
    const r = canvas.getBoundingClientRect();
    for (const t of e.touches) {
      if (t.clientX - r.left < r.width / 2) held.left = true; else held.right = true;
    }
  }
  canvas.addEventListener('touchstart', (e) => {
    if (state === 'title') { startRun(); return; }
    touchSteer(e);
  }, { passive: true });
  canvas.addEventListener('touchmove', touchSteer, { passive: true });
  canvas.addEventListener('touchend', touchSteer, { passive: true });

  // --------------------------------------------------------------- physics
  function step(dt) {
    const steering = held.left !== held.right;
    mode = !steering ? 'down' : held.left ? 'left' : 'right';

    const d = Math.abs(skierX - course.centerAt(skierY));
    if (d > PATH_HW + SNOW_BAND) { crash(); return; }   // into the trees

    // Fresh snow: drag grows with distance from the piste.
    const t = d <= PATH_HW ? 0 : (d - PATH_HW) / SNOW_BAND;
    const target = DOWN_SPEED * (steering ? CARVE_FACTOR : 1) * (1 - DEEP_SNOW_DRAG * t);
    speed += (target - speed) * Math.min(1, dt * 3);

    const targetVx = steering ? (held.left ? -LATERAL : LATERAL) : 0;
    vx += (targetVx - vx) * Math.min(1, dt * 10);

    skierY += speed * dt;
    skierX = Math.max(2, Math.min(W - 3, skierX + vx * dt));

    // A gate is taken when the skier crosses its line between the poles.
    while (nextGate < GATE_COUNT && course.gates[nextGate].y <= skierY) {
      const g = course.gates[nextGate];
      resolveGate(Math.abs(skierX - g.x) < GATE_HALF);
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

  function drawGate(g, sy) {
    const ink = g.red ? VIC.red : VIC.blue;
    for (const side of [-1, 1]) {
      const px = g.x + side * GATE_HALF;
      for (let k = 0; k < 9; k++) put(px, sy - 8 + k, ink);
      // A little triangle flag, pointing into the gate.
      const dir = -side;
      put(px + dir, sy - 8, ink); put(px + 2 * dir, sy - 8, ink); put(px + 3 * dir, sy - 8, ink);
      put(px + dir, sy - 7, ink); put(px + 2 * dir, sy - 7, ink);
      put(px + dir, sy - 6, ink);
    }
  }

  function render() {
    const camY = Math.floor((course ? skierY : 0) - SKIER_Y);
    const centerAt = course ? course.centerAt : () => W / 2;

    for (let sy = 0; sy < H; sy++) {
      const wy = camY + sy;
      const c = centerAt(wy);
      for (let sx = 0; sx < W; sx++) {
        const d = Math.abs(sx - c);
        let col = VIC.white;
        if (d > PATH_HW) {
          // Light blue speckle, denser the further from the piste.
          const t = Math.min(1, (d - PATH_HW) / SNOW_BAND);
          if (hash(sx, wy) < 0.08 + 0.42 * t) col = VIC.lightBlue;
        }
        put(sx, sy, col);
      }
    }

    // Tree line, both sides, on a world-anchored grid.
    const firstRow = Math.floor(camY / TREE_STEP) * TREE_STEP;
    for (let wy = firstRow; wy < camY + H + TREE_STEP; wy += TREE_STEP) {
      const c = centerAt(wy);
      const edge = PATH_HW + SNOW_BAND;
      for (const side of [-1, 1]) {
        for (let k = 0; k < 8; k++) {
          const jitter = Math.floor(hash(k * 31 + side, wy) * 4);
          const x = Math.round(c + side * (edge + 3 + k * 8 + jitter));
          if (x < -4 || x > W + 4) break;
          blit(TREE, x - 3, wy - camY - 6, VIC.green);
        }
      }
    }

    if (course) {
      for (const g of course.gates) {
        const sy = g.y - camY;
        if (sy > -4 && sy < H + 10) drawGate(g, sy);
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
    gateEl.textContent = `${Math.min(nextGate || 0, GATE_COUNT)}/${GATE_COUNT}`;
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
