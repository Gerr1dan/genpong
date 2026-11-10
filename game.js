'use strict';
/* Genpong Online – static, no build step. Live play uses live.js (MQTT relay). */
(() => {
  const $ = (s) => document.querySelector(s);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ---------- Data ----------
  // Every drink has its own glass (cup). `layers`: [[fraction of the liquid height where it starts, colour]]
  const DRINKS = [
    { id: 'beer', name: 'Beer', emoji: '🍺', cup: 'pint', color: '#e9a21b', foam: '#fff1c9', foamH: 0.16 },
    { id: 'wine', name: 'Wine', emoji: '🍷', cup: 'wine', color: '#8e1b3a' },
    { id: 'bubbly', name: 'Bubbly', emoji: '🥂', cup: 'flute', color: '#f3e08a', foam: '#fffbe0', foamH: 0.07 },
    { id: 'mule', name: 'Moscow mule', emoji: '🐴', cup: 'mug', color: '#e9ddb0', foam: '#fbf6df', foamH: 0.18, garnish: 'lime' },
    { id: 'pornstar', name: 'Pornstar martini', emoji: '🍸', cup: 'martini', color: '#f5b335', foam: '#fff2c2', foamH: 0.14, garnish: 'passion' },
    { id: 'stormy', name: 'Dark & stormy', emoji: '⛈️', cup: 'highball', color: '#d8a24a', layers: [[0.55, '#2e1408']], garnish: 'lime' },
    { id: 'mojito', name: 'Mojito', emoji: '🌿', cup: 'highball', color: '#d3efb0', garnish: 'mint' },
    { id: 'sour43', name: '43 sour', emoji: '🍋', cup: 'rocks', color: '#f0cf4a', foam: '#fff7d6', foamH: 0.24 },
    { id: 'water', name: 'Water', emoji: '💧', cup: 'tumbler', color: '#9fdcff' },
    { id: 'cola', name: 'Cola', emoji: '🥤', cup: 'solo', color: '#4a2412' },
    { id: 'oj', name: 'Orange juice', emoji: '🍊', cup: 'tumbler', color: '#ff9f1c', garnish: 'orange' },
    { id: 'mocktail', name: 'Mocktail', emoji: '🍹', cup: 'highball', color: '#ff5fa2', garnish: 'straw' },
  ];
  const drinkById = (id) => DRINKS.find((d) => d.id === id) || DRINKS[0];
  const TEAM = ['#27d3c3', '#ffb703']; // rim colour per player, so identical drinks stay distinguishable

  // Glass shapes: profile = [height 0..1, radius as a fraction of the cup opening]. Used for drawing AND for the ball's
  // collision with the outside of the glass, so a stemmed glass really has a thin stem.
  const CUPS = {
    pint: { prof: [[0, 0.62], [1, 0.96]], glass: true, fb: 0.04, ft: 0.9 },
    tumbler: { prof: [[0, 0.8], [1, 0.93]], glass: true, fb: 0.05, ft: 0.82 },
    highball: { prof: [[0, 0.74], [1, 0.88]], glass: true, fb: 0.05, ft: 0.9 },
    rocks: { prof: [[0, 0.88], [1, 0.98]], glass: true, fb: 0.06, ft: 0.8 },
    solo: { prof: [[0, 0.65], [1, 1]], opaque: { a: '#b81c1c', b: '#ee3b3b', c: '#a01414', inside: '#5a0d0d' }, band: true, fb: 0.04, ft: 0.86 },
    mug: { prof: [[0, 0.82], [1, 0.96]], opaque: { a: '#8a4a1c', b: '#e39a5a', c: '#7a3f17', inside: '#4a2410' }, handle: true, fb: 0.05, ft: 0.9 },
    wine: { prof: [[0, 0.5], [0.06, 0.5], [0.09, 0.1], [0.42, 0.1], [0.5, 0.5], [0.7, 0.9], [0.9, 0.97], [1, 0.9]], glass: true, fb: 0.47, ft: 0.8 },
    flute: { prof: [[0, 0.45], [0.06, 0.45], [0.09, 0.09], [0.4, 0.09], [0.46, 0.42], [0.65, 0.8], [1, 0.9]], glass: true, fb: 0.47, ft: 0.92 },
    martini: { prof: [[0, 0.45], [0.06, 0.45], [0.09, 0.09], [0.4, 0.09], [0.46, 0.25], [1, 1]], glass: true, fb: 0.47, ft: 0.93 },
  };
  function profAt(prof, h) {
    h = clamp(h, 0, 1);
    for (let i = 1; i < prof.length; i++) {
      if (h <= prof[i][0]) {
        const [h0, r0] = prof[i - 1], [h1, r1] = prof[i];
        return r0 + ((r1 - r0) * (h - h0)) / (h1 - h0 || 1);
      }
    }
    return prof[prof.length - 1][1];
  }

  // ---------- World (metres; table top is y=0, z runs away from the thrower) ----------
  const TABLE_W = 0.9, TABLE_L = 2.1;
  const CUP_H = 0.15, CUP_RT = 0.085;
  const BALL_R = 0.04, G = 9.8;
  const CAM = { x: 0, y: 1.0, z: -0.9 };
  const BALL0 = { x: 0, y: 0.45, z: 0.1 };
  const RACK_Z = 1.45;
  const THROW_ANGLE = (55 * Math.PI) / 180;
  const SOLO_THROWS = 15;
  const STEP = 1 / 240;

  // ---------- Pure physics (shared by the game and the headless tests) ----------
  function launchVelocity(dx, dy, maxPull) {
    const a = clamp(dy / maxPull, 0, 1.15);
    const lat = clamp(-dx / maxPull, -1, 1);
    const speed = 2.2 + a * 3.2;
    return { vx: lat * 0.7, vy: speed * Math.sin(THROW_ANGLE), vz: speed * Math.cos(THROW_ANGLE), a };
  }
  function makeRack(style = 'solo') {
    const cups = [], dx = CUP_RT * 2 * 1.04, dz = dx * 0.866;
    for (let r = 0; r < 4; r++)
      for (let i = 0; i <= r; i++) cups.push({ x: (i - r / 2) * dx, z: RACK_Z + r * dz, dead: false, t: 0, style });
    return cups;
  }
  const alive = (cups) => cups.filter((c) => !c.dead);
  function newBall() { return { x: BALL0.x, y: BALL0.y, z: BALL0.z, vx: 0, vy: 0, vz: 0, bounces: 0, events: [], rest: 0 }; }
  const wallR = (c, y) => profAt((CUPS[c.style] || CUPS.solo).prof, y / CUP_H) * CUP_RT;

  // returns {type:'sunk',cup} | {type:'dead'} | null
  function physStep(b, cups, h) {
    const py = b.y;
    b.vy -= G * h;
    b.x += b.vx * h; b.y += b.vy * h; b.z += b.vz * h;

    if (b.vy < 0 && b.y <= BALL_R && b.y > -0.15 && b.z >= 0 && b.z <= TABLE_L && Math.abs(b.x) <= TABLE_W / 2) {
      const imp = -b.vy;
      b.y = BALL_R;
      if (imp > 0.7) { b.vy = imp * 0.74; b.bounces++; b.events.push('bounce'); } else b.vy = 0;
      b.vx *= 0.93; b.vz *= 0.93;
    }
    if (b.y <= BALL_R + 1e-4 && b.vy === 0) { b.vx *= 1 - 1.5 * h; b.vz *= 1 - 1.5 * h; }

    for (const c of cups) {
      if (c.dead) continue;
      const d = Math.hypot(b.x - c.x, b.z - c.z);
      if (py > CUP_H && b.y <= CUP_H && b.vy < 0 && d < CUP_RT - BALL_R * 0.35) return { type: 'sunk', cup: c };
    }
    for (const c of cups) {
      if (c.dead) continue;
      let dx = b.x - c.x, dz = b.z - c.z, d = Math.hypot(dx, dz);
      if (d < 1e-6) { dx = 0; dz = -1; d = 1; }
      const hx = dx / d, hz = dz / d;
      if (b.y < CUP_H - 0.01) {
        const wr = wallR(c, Math.max(b.y, 0)) + BALL_R; // outer wall follows the glass shape
        if (b.y > -BALL_R && d < wr) {
          b.x = c.x + hx * wr; b.z = c.z + hz * wr;
          const vn = b.vx * hx + b.vz * hz;
          if (vn < 0) { b.vx -= 1.5 * vn * hx; b.vz -= 1.5 * vn * hz; b.vx *= 0.85; b.vz *= 0.85; b.events.push('rim'); }
        }
      } else if (b.y < CUP_H + BALL_R + 0.02 && d < CUP_RT + BALL_R + 0.02) {
        const rx = c.x + hx * CUP_RT, rz = c.z + hz * CUP_RT;
        let nx = b.x - rx, ny = b.y - CUP_H, nz = b.z - rz;
        const nl = Math.hypot(nx, ny, nz);
        if (nl < BALL_R && nl > 1e-6) {
          nx /= nl; ny /= nl; nz /= nl;
          b.x = rx + nx * BALL_R; b.y = CUP_H + ny * BALL_R; b.z = rz + nz * BALL_R;
          const vn = b.vx * nx + b.vy * ny + b.vz * nz;
          if (vn < 0) { b.vx -= 1.5 * vn * nx; b.vy -= 1.5 * vn * ny; b.vz -= 1.5 * vn * nz; b.events.push('rim'); }
        }
      }
    }
    if (b.y < -0.85 || b.z > 3.6 || b.z < -1.2 || Math.abs(b.x) > 2.2) return { type: 'dead' };
    return null;
  }
  function simulate(dx, dy, cups, maxPull = 300) {
    const v = launchVelocity(dx, dy, maxPull), b = newBall();
    b.vx = v.vx; b.vy = v.vy; b.vz = v.vz;
    for (let i = 0; i < 240 * 6; i++) {
      const r = physStep(b, cups, STEP);
      if (r) return { ...r, bounced: b.bounces > 0, z: b.z };
    }
    return { type: 'timeout' };
  }

  // ---------- Game state ----------
  const S = {
    screen: 'menu', phase: 'idle', mode: 'solo', players: [], cur: 0, live: null,
    score: 0, streak: 0, throwsLeft: 0, throwsUsed: 0, cupsDown: 0,
    throwsThisTurn: 0, hitsThisTurn: 0,
    ball: newBall(), ballVisible: true, flightT: 0, remote: false, simDone: false, acc: 0, pendingThrow: null,
    drag: null, wait: 0, after: null, particles: [], hintShown: false,
  };
  const settings = Object.assign(
    { mode: 'solo', n1: '', d1: 'beer', n2: '', d2: 'water' },
    JSON.parse(localStorage.getItem('genpong.settings') || '{}')
  );
  if (!['solo', 'versus', 'online'].includes(settings.mode)) settings.mode = 'solo';
  const saveSettings = () => localStorage.setItem('genpong.settings', JSON.stringify(settings));
  const getBest = () => +(localStorage.getItem('genpong.best') || 0);
  const target = () => (S.mode === 'solo' ? S.players[0] : S.players[1 - S.cur]);
  const iAmThrower = () => !S.live || S.cur === S.live.me;

  // ---------- Canvas / projection ----------
  const canvas = $('#c');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, F = 1, HY = 0, FLIP = false;
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    applyView();
  }
  // Solo: close-up behind the table. Versus: pulled back and raised so both racks fit on screen.
  function applyView() {
    if (S.mode === 'versus' && S.screen === 'game') {
      CAM.y = 1.8; CAM.z = -2.2;
      const dzOwn = 0.1 - CAM.z, dzFar = TABLE_L - CAM.z;
      const Fh = (W * 0.94 * dzOwn) / (2 * 0.37);
      const Fv = (H * 0.72) / (CAM.y * (1 / dzOwn - 1 / dzFar));
      F = Math.min(Fh, Fv);
      const yTop = (F * CAM.y) / dzFar, yBot = (F * CAM.y) / dzOwn;
      HY = H * 0.47 - (yBot - yTop) / 2 - yTop;
    } else {
      CAM.y = 1.0; CAM.z = -0.9;
      F = Math.min(W * 1.4, H * 1.0);
      HY = H * 0.34;
    }
  }
  function P(x, y, z) {
    const dz = z - CAM.z;
    return { x: W / 2 + (F * (x - CAM.x)) / dz, y: HY + (F * (CAM.y - y)) / dz, s: F / dz, dz };
  }
  // world point as seen by this viewer (when watching the opponent throw we look from the other end of the table)
  const PV = (x, y, z) => (FLIP ? P(-x, y, TABLE_L - z) : P(x, y, z));
  window.addEventListener('resize', resize);
  resize();
  const maxPull = () => Math.min(Math.min(W, H) * 0.8, 420);

  // ---------- Audio ----------
  let AC = null, muted = localStorage.getItem('genpong.muted') === '1';
  function tone(freq, dur, type = 'sine', vol = 0.15, slideTo = null, delay = 0) {
    if (muted) return;
    try {
      AC = AC || new (window.AudioContext || window.webkitAudioContext)();
      const t0 = AC.currentTime + delay;
      const o = AC.createOscillator(), g = AC.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t0);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
      g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(AC.destination); o.start(t0); o.stop(t0 + dur + 0.02);
    } catch (e) { /* audio unavailable */ }
  }
  const sfx = {
    throw: () => tone(400, 0.18, 'triangle', 0.1, 900),
    bounce: () => tone(700, 0.07, 'square', 0.05, 500),
    rim: () => tone(1200, 0.08, 'triangle', 0.08, 800),
    sink: () => { tone(500, 0.12, 'sine', 0.18, 900); tone(900, 0.2, 'sine', 0.15, 1400, 0.1); },
    miss: () => tone(220, 0.25, 'sawtooth', 0.06, 110),
    win: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.25, 'triangle', 0.15, null, i * 0.12)),
  };

  // ---------- Menu ----------
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function buildDrinks(el, key) {
    el.innerHTML = '';
    DRINKS.forEach((d) => {
      const b = document.createElement('button');
      b.innerHTML = `<i style="background:${d.color}"></i>${d.emoji} ${d.name}`;
      b.className = settings[key] === d.id ? 'on' : '';
      b.onclick = () => { settings[key] = d.id; saveSettings(); buildDrinks(el, key); };
      el.appendChild(b);
    });
  }
  function refreshMenu() {
    const m = settings.mode;
    document.querySelectorAll('#modeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
    $('#p2').hidden = m !== 'versus';
    $('#onlineBox').hidden = m !== 'online';
    $('#play').hidden = m === 'online';
    $('#p1').querySelector('label').textContent = m === 'versus' ? 'Player 1' : m === 'online' ? 'You' : 'Your name';
    $('#n1').value = settings.n1; $('#n2').value = settings.n2;
    buildDrinks($('#d1'), 'd1'); buildDrinks($('#d2'), 'd2');
    const best = getBest();
    $('#best').textContent = best ? `Your solo best: ${best}` : '';
  }
  document.querySelectorAll('#modeSeg button').forEach((b) => {
    b.onclick = () => { settings.mode = b.dataset.mode; saveSettings(); refreshMenu(); };
  });
  $('#n1').oninput = (e) => { settings.n1 = e.target.value; saveSettings(); };
  $('#n2').oninput = (e) => { settings.n2 = e.target.value; saveSettings(); };
  $('#play').onclick = () => startLocalGame();
  $('#menuBtn').onclick = () => { leaveLive(true); showMenu(); };
  function setMuteIcon() { $('#muteBtn').textContent = muted ? '🔇' : '🔊'; }
  $('#muteBtn').onclick = () => { muted = !muted; localStorage.setItem('genpong.muted', muted ? '1' : '0'); setMuteIcon(); };
  setMuteIcon();

  function showMenu() {
    S.screen = 'menu'; S.phase = 'idle'; S.mode = settings.mode === 'solo' ? 'solo' : 'versus'; applyView();
    $('#menu').classList.remove('hidden'); $('#result').classList.add('hidden'); $('#lobby').classList.add('hidden');
    $('#hud').classList.add('hidden'); $('#hint').classList.add('hidden');
    refreshMenu();
  }

  // ---------- Match setup ----------
  const myProfile = () => ({ name: (settings.n1 || '').trim().slice(0, 16), drink: settings.d1 });
  function makePlayer(prof, i, fallback) {
    const drink = drinkById(prof.drink);
    return { name: (prof.name || '').trim() || fallback, drink, team: TEAM[i], cups: makeRack(drink.cup) };
  }
  function beginMatch(players, first, mode) {
    S.mode = mode; S.players = players; S.cur = first;
    S.score = 0; S.streak = 0; S.cupsDown = 0; S.throwsUsed = 0; S.throwsLeft = SOLO_THROWS;
    S.throwsThisTurn = 0; S.hitsThisTurn = 0; S.particles = []; S.pendingThrow = null; S.remote = false;
    S.screen = 'game'; applyView();
    $('#menu').classList.add('hidden'); $('#result').classList.add('hidden'); $('#lobby').classList.add('hidden');
    $('#hud').classList.remove('hidden');
    if (!S.hintShown && iAmThrower()) $('#hint').classList.remove('hidden');
    if (mode === 'versus') banner(S.live ? (S.cur === S.live.me ? 'You start!' : `${players[S.cur].name} starts!`) : `${players[first].name} starts!`, false);
    readyBall();
  }
  function startLocalGame() {
    S.live = null;
    const p1 = makePlayer(myProfile(), 0, settings.mode === 'solo' ? 'You' : 'Player 1');
    if (settings.mode === 'solo') return beginMatch([p1], 0, 'solo');
    const p2 = makePlayer({ name: settings.n2, drink: settings.d2 }, 1, 'Player 2');
    beginMatch([p1, p2], 0, 'versus');
  }

  function readyBall() {
    S.ball = newBall(); S.ballVisible = true; S.remote = false; S.simDone = false; S.drag = null;
    S.phase = 'aim'; updateHud();
    if (S.pendingThrow && !iAmThrower()) { const v = S.pendingThrow; S.pendingThrow = null; launch(v, true); }
  }
  function later(sec, fn) { S.wait = sec; S.after = fn; }

  function launch(v, remote) {
    const b = newBall(); b.vx = v.vx; b.vy = v.vy; b.vz = v.vz;
    S.ball = b; S.ballVisible = true; S.phase = 'flying'; S.flightT = 0; S.acc = 0; S.remote = remote; S.simDone = false;
    sfx.throw();
  }
  function throwBall(dx, dy) {
    const v = launchVelocity(dx, dy, maxPull());
    S.hintShown = true; $('#hint').classList.add('hidden');
    if (S.live) Live.send({ t: 'throw', vx: v.vx, vy: v.vy, vz: v.vz });
    launch(v, false);
  }

  function removeCups(rack, cup, n) {
    let removed = 0;
    cup.dead = true; cup.t = 0; removed++;
    while (removed < n) {
      const left = alive(rack);
      if (!left.length) break;
      left.sort((a, b) => Math.hypot(a.x - cup.x, a.z - cup.z) - Math.hypot(b.x - cup.x, b.z - cup.z));
      left[0].dead = true; left[0].t = 0; removed++;
    }
    return removed;
  }
  function spawnSplash(cup, color) {
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2, sp = 0.3 + Math.random() * 0.8;
      S.particles.push({ x: cup.x, y: CUP_H, z: cup.z, vx: Math.cos(a) * sp * 0.5, vy: 1.2 + Math.random() * 1.6, vz: Math.sin(a) * sp * 0.5, life: 0.9, color });
    }
  }

  // res: {type:'sunk'|'miss'|'dead', cup, bounced}
  function endThrow(res) {
    if (S.phase !== 'flying' && S.phase !== 'aim') return;
    S.phase = 'resolving';
    const owner = target(), hit = res.type === 'sunk';
    const bounced = hit && !!res.bounced;
    if (S.live && !S.remote) Live.send({ t: 'res', hit, ci: hit ? owner.cups.indexOf(res.cup) : -1, bounced });
    if (hit) { S.ballVisible = false; spawnSplash(res.cup, owner.drink.color); sfx.sink(); } else sfx.miss();
    S.throwsUsed++;
    if (S.mode === 'solo') resolveSolo(hit, bounced, res.cup);
    else resolveVersus(hit, bounced, res.cup);
  }

  function resolveSolo(hit, bounced, cup) {
    const me = S.players[0];
    S.throwsLeft--;
    if (hit) {
      S.streak++;
      S.cupsDown += removeCups(me.cups, cup, bounced ? 2 : 1);
      const pts = (bounced ? 200 : 100) + (S.streak - 1) * 50;
      S.score += pts;
      banner(`${bounced ? 'BOUNCE SHOT! ' : ''}+${pts} ${me.drink.emoji}${S.streak > 1 ? '  x' + S.streak + ' streak' : ''}`, false);
    } else { S.streak = 0; banner('Miss!', true); }
    updateHud();
    if (!alive(me.cups).length) {
      const bonus = S.throwsLeft * 50; S.score += bonus; sfx.win();
      later(1.1, () => showResult(true, bonus));
    } else if (S.throwsLeft <= 0) later(1.1, () => showResult(false, 0));
    else later(0.9, readyBall);
  }

  function resolveVersus(hit, bounced, cup) {
    const opp = S.players[1 - S.cur];
    S.throwsThisTurn++;
    if (hit) {
      S.hitsThisTurn++;
      removeCups(opp.cups, cup, bounced ? 2 : 1);
      const you = S.live && S.live.me === 1 - S.cur;
      banner(`${bounced ? 'BOUNCE! ' : ''}${you ? 'You drink' : opp.name + ' drinks'} ${opp.drink.emoji}`, false);
    } else banner('Miss!', true);
    updateHud();
    if (!alive(opp.cups).length) { sfx.win(); later(1.2, () => showResult(true, 0)); return; }
    if (S.throwsThisTurn >= 2) {
      const ballsBack = S.hitsThisTurn === 2;
      S.throwsThisTurn = 0; S.hitsThisTurn = 0;
      if (ballsBack) later(1.2, () => { banner(`BALLS BACK! ${nameOf(S.cur)} again`, false); readyBall(); });
      else later(1.2, () => { S.cur = 1 - S.cur; banner(turnText(), false); readyBall(); });
    } else later(0.9, readyBall);
  }
  const nameOf = (i) => (S.live && S.live.me === i ? 'You' : S.players[i].name);
  const turnText = () => (S.live && S.cur === S.live.me ? 'Your turn!' : `${S.players[S.cur].name}'s turn`);

  // ---------- HUD / banner / result ----------
  function banner(text, miss) {
    const el = $('#banner');
    el.textContent = text; el.className = ''; void el.offsetWidth;
    el.className = 'show' + (miss ? ' miss' : '');
  }
  function updateHud() {
    const L = $('#hudL'), M = $('#hudM'), R = $('#hudR');
    if (S.mode === 'solo') {
      const me = S.players[0];
      L.className = 'hud-side'; R.innerHTML = '';
      L.innerHTML = `<small>${esc(me.name)}</small><span class="big">${S.score}</span>`;
      M.innerHTML = `${alive(me.cups).length} cups left<small>${S.throwsLeft} throws left${S.streak > 1 ? ' · 🔥 x' + S.streak : ''}</small>`;
    } else {
      const [a, b] = S.players, me = S.live ? S.live.me : -1;
      L.className = 'hud-side' + (S.cur === 0 ? ' active' : '');
      R.className = 'hud-side right' + (S.cur === 1 ? ' active' : '');
      L.innerHTML = `${a.drink.emoji} ${esc(a.name)}${me === 0 ? ' (you)' : ''}<small>${alive(a.cups).length} cups left</small>`;
      R.innerHTML = `${esc(b.name)}${me === 1 ? ' (you)' : ''} ${b.drink.emoji}<small>${alive(b.cups).length} cups left</small>`;
      const mine = !S.live || S.cur === me;
      M.innerHTML = `${S.live ? (mine ? 'Your throw' : 'Watching ' + esc(S.players[S.cur].name)) : esc(S.players[S.cur].name)}<small>Throw ${Math.min(S.throwsThisTurn + 1, 2)}/2</small>`;
    }
  }

  function showResult(cleared, bonus) {
    S.phase = 'over';
    const card = $('#resultCard');
    if (S.mode === 'solo') {
      const me = S.players[0], best = getBest(), isBest = S.score > best;
      if (isBest) localStorage.setItem('genpong.best', String(S.score));
      const text = `${me.drink.emoji} ${me.name} scored ${S.score} on Genpong Online! (${S.cupsDown}/10 cups in ${S.throwsUsed} throws) Think you can beat it? ${location.href.split('#')[0]}`;
      card.innerHTML = `
        <h2>${cleared ? 'Table cleared! 🎉' : 'Out of throws'}</h2>
        <div class="sub">${isBest ? '🏆 New personal best!' : 'Personal best: ' + Math.max(best, S.score)}</div>
        <div class="stats"><div><b>${S.score}</b><span>Score</span></div><div><b>${S.cupsDown}/10</b><span>Cups</span></div>
        <div><b>${S.throwsUsed}</b><span>Throws</span></div></div>
        ${cleared && bonus ? `<p class="small dim">Includes +${bonus} bonus for unused throws</p>` : ''}
        <textarea id="shareText" readonly>${esc(text)}</textarea>
        <button class="primary" id="shareBtn">${navigator.share ? 'Share score' : 'Copy score for Teams'}</button>
        <button class="secondary" id="again">Play again</button>
        <button class="secondary" id="toMenu">Menu</button>`;
      $('#shareBtn').onclick = async () => {
        if (navigator.share) { try { await navigator.share({ text }); return; } catch (e) { return; } }
        copyText(text, $('#shareBtn'));
      };
      $('#again').onclick = startLocalGame;
    } else {
      const w = S.players[S.cur], l = S.players[1 - S.cur], iWon = S.live && S.live.me === S.cur;
      card.innerHTML = `
        <h2>${S.live ? (iWon ? 'You win! 🏆' : esc(w.name) + ' wins!') : esc(w.name) + ' wins! 🏆'}</h2>
        <div class="sub">${S.live && !iWon ? 'You drink' : esc(l.name) + ' drinks'} the rest ${l.drink.emoji} (or water. Water is fine.)</div>
        <div class="stats"><div><b>${alive(w.cups).length}</b><span>${esc(w.name)}'s cups left</span></div>
        <div><b>${S.throwsUsed}</b><span>Total throws</span></div></div>
        <button class="primary" id="again">Rematch</button>
        <button class="secondary" id="toMenu">Menu</button>`;
      $('#again').onclick = S.live ? requestRematch : startLocalGame;
    }
    $('#toMenu').onclick = () => { leaveLive(true); showMenu(); };
    $('#result').classList.remove('hidden');
  }
  function copyText(text, btn) {
    const done = () => { const o = btn.textContent; btn.textContent = 'Copied! ✅'; setTimeout(() => (btn.textContent = o), 2200); };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, () => fallbackCopy(done));
    else fallbackCopy(done);
  }
  function fallbackCopy(done) {
    const ta = $('#shareText') && $('#shareText').offsetParent ? $('#shareText') : $('#lobbyLink'); ta.focus(); ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { /* user can long-press */ }
  }

  // ---------- Online play ----------
  const Live = window.GenpongLive;
  let pair = null; // {role:'host'|'guest', code, joinTimer}
  const netStatus = (t, bad) => { const el = $('#netStatus'); el.textContent = t || ''; el.style.color = bad ? '#ff8a8a' : ''; };
  const linkFor = (code) => location.href.split('#')[0] + '#' + code;
  const newCode = () => { const L = 'BCDFGHJKLMNPQRSTVWXZ'; let s = ''; for (let i = 0; i < 4; i++) s += L[Math.floor(Math.random() * L.length)]; return s; };

  async function createGame() {
    if (!Live) return netStatus('Online play is not available in this build.', true);
    leaveLive(true);
    const code = newCode(); pair = { role: 'host', code };
    netStatus('Connecting…');
    try { await Live.open(code, onLiveMsg, onLiveState); } catch (e) { pair = null; return netStatus('Could not reach the game server. Check your connection and try again.', true); }
    netStatus('');
    $('#lobbyCode').textContent = code;
    $('#lobbyLink').value = linkFor(code);
    $('#lobby').classList.remove('hidden');
  }
  async function joinGame() {
    if (!Live) return netStatus('Online play is not available in this build.', true);
    const code = ($('#codeIn').value || '').toUpperCase().replace(/[^A-Z]/g, '');
    if (code.length !== 4) return netStatus('Enter the 4-letter code from your friend.', true);
    leaveLive(true);
    pair = { role: 'guest', code }; netStatus('Connecting…');
    try { await Live.open(code, onLiveMsg, onLiveState); } catch (e) { pair = null; return netStatus('Could not reach the game server. Check your connection and try again.', true); }
    netStatus('Looking for the game…');
    let tries = 0;
    const ask = () => {
      if (!pair || pair.role !== 'guest' || S.live) return;
      if (tries++ >= 6) { leaveLive(true); return netStatus(`No game found with code ${code}. Check the code, or ask your friend to create a new one.`, true); }
      Live.send({ t: 'join', profile: myProfile() });
      pair.joinTimer = setTimeout(ask, 1500);
    };
    ask();
  }
  function leaveLive(sayBye) {
    if (pair && pair.joinTimer) clearTimeout(pair.joinTimer);
    const was = !!(pair || S.live);
    pair = null; S.live = null; S.pendingThrow = null;
    if (Live && was) Live.close(sayBye);
    $('#lobby').classList.add('hidden'); $('#peerGone').classList.add('hidden');
  }
  function startOnline(me, profs, first) {
    S.live = { me, profs, first, rematchMe: false, rematchPeer: false };
    $('#lobby').classList.add('hidden'); netStatus('');
    const players = [makePlayer(profs[0], 0, 'Player 1'), makePlayer(profs[1], 1, 'Player 2')];
    if (players[0].name === players[1].name) players[1].name += ' (2)';
    beginMatch(players, first, 'versus');
  }
  function onLiveMsg(m) {
    if (m.t === 'join' && pair && pair.role === 'host' && !S.live) {
      Live.send({ t: 'welcome', profile: myProfile(), to: m.f });
      startOnline(0, [myProfile(), m.profile || {}], 0);
    } else if (m.t === 'welcome' && pair && pair.role === 'guest' && !S.live && m.to === Live.id()) {
      clearTimeout(pair.joinTimer);
      startOnline(1, [m.profile || {}, myProfile()], 0);
    } else if (!S.live) return;
    else if (m.t === 'throw') {
      const v = { vx: m.vx, vy: m.vy, vz: m.vz };
      if (S.cur === S.live.me) return; // not their turn: ignore
      if (S.phase === 'aim') launch(v, true); else S.pendingThrow = v;
    } else if (m.t === 'res') {
      if (S.cur === S.live.me || (S.phase !== 'flying' && S.phase !== 'aim')) return;
      const owner = target();
      endThrow({ type: m.hit ? 'sunk' : 'miss', cup: m.hit ? owner.cups[m.ci] : null, bounced: m.bounced });
    } else if (m.t === 'rematch') {
      S.live.rematchPeer = true; maybeRematch();
    } else if (m.t === 'bye') {
      peerGone('Your opponent left the game.');
    }
  }
  function onLiveState(st) { if (st === 'lost' && S.live) peerGone('Lost contact with your opponent.'); }
  function peerGone(text) {
    if (!S.live || S.screen !== 'game') return;
    S.phase = 'over'; $('#peerGoneText').textContent = text; $('#peerGone').classList.remove('hidden');
  }
  function requestRematch() {
    if (!S.live) return;
    S.live.rematchMe = true; Live.send({ t: 'rematch' });
    const b = $('#again'); if (b) { b.textContent = 'Waiting for opponent…'; b.disabled = true; }
    maybeRematch();
  }
  function maybeRematch() {
    const L = S.live;
    if (L && L.rematchMe && L.rematchPeer) startOnline(L.me, L.profs, 1 - L.first);
  }
  $('#createBtn').onclick = createGame;
  $('#joinBtn').onclick = joinGame;
  $('#codeIn').oninput = (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ''); };
  $('#lobbyCancel').onclick = () => { leaveLive(true); showMenu(); };
  $('#lobbyCopy').onclick = () => copyText(linkFor(pair ? pair.code : ''), $('#lobbyCopy'));
  $('#peerGoneMenu').onclick = () => { leaveLive(false); showMenu(); };
  window.addEventListener('pagehide', () => { if (S.live || pair) leaveLive(true); });

  // ---------- Input ----------
  canvas.addEventListener('pointerdown', (e) => {
    if (S.phase !== 'aim' || S.screen !== 'game' || !iAmThrower()) return;
    canvas.setPointerCapture(e.pointerId);
    S.drag = { sx: e.clientX, sy: e.clientY, cx: e.clientX, cy: e.clientY, id: e.pointerId };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (S.drag && S.drag.id === e.pointerId) { S.drag.cx = e.clientX; S.drag.cy = e.clientY; }
  });
  const release = (e, cancel) => {
    if (!S.drag || S.drag.id !== e.pointerId) return;
    const d = S.drag; S.drag = null;
    if (cancel) return;
    const dx = d.cx - d.sx, dy = d.cy - d.sy;
    if (dy > 24) throwBall(dx, dy);
  };
  canvas.addEventListener('pointerup', (e) => release(e, false));
  canvas.addEventListener('pointercancel', (e) => release(e, true));
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---------- Update ----------
  function update(dt) {
    for (const p of S.particles) { p.vy -= G * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.life -= dt; }
    S.particles = S.particles.filter((p) => p.life > 0 && p.y > -0.2);
    for (const pl of S.players) for (const c of pl.cups) if (c.dead && c.t < 0.7) c.t += dt;

    if (S.phase === 'flying') {
      const cups = alive(target().cups);
      S.acc += dt; S.flightT += dt;
      let n = 0;
      while (S.acc >= STEP && n++ < 40 && S.phase === 'flying' && !S.simDone) {
        S.acc -= STEP;
        const b = S.ball, r = physStep(b, cups, STEP);
        for (const ev of b.events.splice(0)) (ev === 'bounce' ? sfx.bounce : sfx.rim)();
        let res = r ? { ...r, bounced: b.bounces > 0 } : null;
        const sp = Math.hypot(b.vx, b.vz);
        b.rest = b.y <= BALL_R + 1e-3 && sp < 0.25 ? b.rest + STEP : 0;
        if (!res && b.rest > 0.4) res = { type: 'miss' };
        if (!res && S.flightT > 6) res = { type: 'miss' };
        if (res) {
          if (S.remote) { S.simDone = true; if (res.type === 'sunk') S.ballVisible = false; } // wait for the thrower's verdict
          else endThrow(res);
        }
      }
      if (S.acc > 0.25) S.acc = 0;
    }
    if (S.wait > 0) {
      S.wait -= dt;
      if (S.wait <= 0 && S.after) { const f = S.after; S.after = null; f(); }
    }
  }

  // ---------- Rendering ----------
  function drawBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0b1230'); g.addColorStop(0.45, '#17265c'); g.addColorStop(1, '#0a1128');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const sp = P(0, 0, TABLE_L * 0.8);
    const rg = ctx.createRadialGradient(sp.x, sp.y, 10, sp.x, sp.y, F * 0.9);
    rg.addColorStop(0, 'rgba(120,170,255,.28)'); rg.addColorStop(1, 'rgba(120,170,255,0)');
    ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
  }
  function drawTable() {
    const c = [P(-TABLE_W / 2, 0, 0), P(TABLE_W / 2, 0, 0), P(TABLE_W / 2, 0, TABLE_L), P(-TABLE_W / 2, 0, TABLE_L)];
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 18;
    ctx.beginPath(); c.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath();
    const g = ctx.createLinearGradient(0, c[3].y, 0, Math.min(c[0].y, H));
    g.addColorStop(0, '#1f9c92'); g.addColorStop(1, '#14766f');
    ctx.fillStyle = g; ctx.fill(); ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = Math.max(2, F * 0.004); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = Math.max(1, F * 0.0025);
    const a = P(0, 0, 0), b = P(0, 0, TABLE_L);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    const l1 = P(-TABLE_W / 2, 0, TABLE_L / 2), l2 = P(TABLE_W / 2, 0, TABLE_L / 2);
    ctx.beginPath(); ctx.moveTo(l1.x, l1.y); ctx.lineTo(l2.x, l2.y); ctx.stroke();
    const t1 = P(-TABLE_W / 2, 0, TABLE_L), t2 = P(TABLE_W / 2, 0, TABLE_L);
    ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fillRect(t1.x, t1.y - 2, t2.x - t1.x, 3);
  }
  function ellipse(x, y, rx, ry) { ctx.beginPath(); ctx.ellipse(x, y, Math.max(rx, 0.1), Math.max(ry, 0.1), 0, 0, Math.PI * 2); }

  // One glass, in perspective. Glasses are see-through with the drink visible; mugs and plastic cups are opaque.
  function drawCup(c, drink, team, lift = 0, alpha = 1, scale = 1) {
    const st = CUPS[drink.cup] || CUPS.solo;
    const at = (h) => {
      const y = lift + h * CUP_H, p = PV(c.x, y, c.z), rx = profAt(st.prof, h) * CUP_RT * p.s * scale;
      return { x: p.x, y: p.y, rx, ry: (rx * (CAM.y - y)) / p.dz, s: p.s };
    };
    const base = at(0), top = at(1);
    // closed outline of the glass between heights h0..h1 (inset shrinks it for the liquid)
    const band = (h0, h1, inset = 1) => {
      const M = 14;
      ctx.beginPath();
      let p = at(h1); ctx.moveTo(p.x - p.rx * inset, p.y);
      for (let i = 1; i <= M; i++) { p = at(h1 + ((h0 - h1) * i) / M); ctx.lineTo(p.x - p.rx * inset, p.y); }
      ctx.ellipse(p.x, p.y, Math.max(p.rx * inset, 0.1), Math.max(p.ry * inset, 0.1), 0, Math.PI, 0, true);
      for (let i = M - 1; i >= 0; i--) { p = at(h1 + ((h0 - h1) * i) / M); ctx.lineTo(p.x + p.rx * inset, p.y); }
      ctx.closePath();
    };
    const lg = (a, b2, c2, x, rx) => { const g = ctx.createLinearGradient(x - rx, 0, x + rx, 0); g.addColorStop(0, a); g.addColorStop(0.35, b2); g.addColorStop(1, c2); return g; };
    ctx.save(); ctx.globalAlpha = alpha;
    if (lift === 0) { ctx.fillStyle = 'rgba(0,0,0,.28)'; ellipse(base.x + base.rx * 0.25, base.y + base.ry * 0.3, Math.max(base.rx, top.rx * 0.8) * 1.05, base.ry * 1.4); ctx.fill(); }

    if (st.handle) { // handle sits behind the body edge
      const m = at(0.55), hh = Math.abs(at(0.25).y - at(0.8).y);
      ctx.strokeStyle = '#b7672f'; ctx.lineWidth = Math.max(2, top.rx * 0.2); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.ellipse(m.x + m.rx * 0.95, m.y, m.rx * 0.5, hh * 0.5, 0, -Math.PI / 2, Math.PI / 2); ctx.stroke();
    }
    const fb = st.fb, ft = st.ft;
    if (st.opaque) {
      const o = st.opaque;
      band(0, 1); ctx.fillStyle = lg(o.a, o.b, o.c, top.x, top.rx); ctx.fill();
      if (st.band) {
        const a1 = at(0.45), a2 = at(0.62);
        ctx.beginPath(); ctx.moveTo(a2.x - a2.rx, a2.y); ctx.lineTo(a1.x - a1.rx, a1.y); ctx.lineTo(a1.x + a1.rx, a1.y); ctx.lineTo(a2.x + a2.rx, a2.y); ctx.closePath();
        ctx.fillStyle = 'rgba(255,255,255,.88)'; ctx.fill();
      }
      ctx.fillStyle = o.inside; ellipse(top.x, top.y, top.rx, top.ry); ctx.fill();
    } else {
      band(0, 1); ctx.fillStyle = lg('rgba(255,255,255,.10)', 'rgba(255,255,255,.26)', 'rgba(255,255,255,.07)', top.x, top.rx); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.fillStyle = 'rgba(15,25,60,.35)'; ellipse(top.x, top.y, top.rx, top.ry); ctx.fill();
    }
    const lt = at(ft); // liquid
    if (st.opaque) {
      ctx.fillStyle = drink.color; ellipse(lt.x, lt.y, lt.rx * 0.92, lt.ry * 0.92); ctx.fill();
    } else {
      band(fb, ft, 0.92); ctx.fillStyle = lg(shade(drink.color, -0.25), drink.color, shade(drink.color, -0.2), lt.x, lt.rx); ctx.fill();
      for (const [frac, col] of drink.layers || []) {
        band(fb + (ft - fb) * frac, ft, 0.92); ctx.fillStyle = col; ctx.fill();
      }
      const surf = (drink.layers || []).length ? drink.layers[drink.layers.length - 1][1] : shade(drink.color, 0.18);
      ctx.fillStyle = surf; ellipse(lt.x, lt.y, lt.rx * 0.92, lt.ry * 0.92); ctx.fill();
    }
    if (drink.foam) {
      const fh = ft - (ft - fb) * (drink.foamH || 0.15);
      if (!st.opaque) { band(fh, ft, 0.93); ctx.fillStyle = drink.foam; ctx.fill(); }
      ctx.fillStyle = drink.foam; ellipse(lt.x, lt.y, lt.rx * 0.92, lt.ry * 0.92); ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,.22)'; ellipse(lt.x - lt.rx * 0.25, lt.y - 0.5, lt.rx * 0.45, lt.ry * 0.3); ctx.fill();
    if (!st.opaque) { // glass highlight
      const a1 = at(0.12), a2 = at(0.9);
      ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.lineWidth = Math.max(1.5, top.rx * 0.05); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(a1.x - a1.rx * 0.6, a1.y); ctx.lineTo(a2.x - a2.rx * 0.6, a2.y); ctx.stroke();
    }
    garnish(drink.garnish, top, lt);
    ctx.strokeStyle = team || '#fff'; ctx.lineWidth = Math.max(2, top.rx * 0.1); ellipse(top.x, top.y, top.rx, top.ry); ctx.stroke(); // team-coloured rim
    ctx.restore();
  }
  function garnish(kind, top, lt) {
    if (!kind) return;
    const r = top.rx;
    if (kind === 'lime' || kind === 'orange') {
      const col = kind === 'lime' ? ['#6aa84f', '#c9e89b'] : ['#f08a00', '#ffd27a'];
      const x = top.x - r * 0.62, y = top.y + top.ry * 0.1;
      ctx.fillStyle = col[0]; ellipse(x, y, r * 0.34, r * 0.34); ctx.fill();
      ctx.fillStyle = col[1]; ellipse(x, y, r * 0.25, r * 0.25); ctx.fill();
      ctx.strokeStyle = col[0]; ctx.lineWidth = 1;
      for (let i = 0; i < 3; i++) { const a = (i * Math.PI) / 3; ctx.beginPath(); ctx.moveTo(x - Math.cos(a) * r * 0.25, y - Math.sin(a) * r * 0.25); ctx.lineTo(x + Math.cos(a) * r * 0.25, y + Math.sin(a) * r * 0.25); ctx.stroke(); }
    } else if (kind === 'mint') {
      ctx.fillStyle = '#2e9e4f';
      [[-0.3, -0.35], [0.05, -0.55], [0.35, -0.3], [0.0, -0.2]].forEach(([dx, dy], i) => {
        ctx.save(); ctx.translate(top.x + dx * r, top.y + dy * r); ctx.rotate((i - 1.5) * 0.5);
        ctx.beginPath(); ctx.ellipse(0, 0, r * 0.2, r * 0.34, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      });
      ctx.fillStyle = '#8fd16a'; ellipse(top.x + r * 0.45, top.y + top.ry * 0.2, r * 0.22, r * 0.22); ctx.fill();
    } else if (kind === 'passion') {
      const x = top.x, y = lt.y + lt.ry * 0.15;
      ctx.fillStyle = '#f4a01c'; ellipse(x, y, r * 0.42, Math.max(lt.ry * 0.7, r * 0.2)); ctx.fill();
      ctx.fillStyle = '#4a2d0c';
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; ellipse(x + Math.cos(a) * r * 0.16, y + Math.sin(a) * r * 0.07, r * 0.045, r * 0.045); ctx.fill(); }
    } else if (kind === 'straw') {
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(2, r * 0.12); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(top.x + r * 0.2, lt.y); ctx.lineTo(top.x + r * 0.55, top.y - r * 1.1); ctx.stroke();
      ctx.strokeStyle = '#ff5fa2'; ctx.setLineDash([r * 0.2, r * 0.2]); ctx.stroke(); ctx.setLineDash([]);
    }
  }
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const f = (v) => clamp(Math.round(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt)), 0, 255);
    return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
  }

  function drawBall(b) {
    const p = PV(b.x, b.y, b.z), r = Math.max(BALL_R * p.s, 2.5);
    if (b.y >= 0 && b.z >= 0 && b.z <= TABLE_L && Math.abs(b.x) <= TABLE_W / 2) {
      const sh = PV(b.x, 0, b.z), k = clamp(1 - b.y * 0.8, 0.25, 1);
      ctx.fillStyle = `rgba(0,0,0,${0.3 * k})`; ellipse(sh.x, sh.y, BALL_R * sh.s * 1.1, (BALL_R * sh.s * 1.1 * CAM.y) / sh.dz); ctx.fill();
    }
    const g = ctx.createRadialGradient(p.x - r * 0.35, p.y - r * 0.35, r * 0.1, p.x, p.y, r);
    g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#d9d4c4');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
  }
  function drawAim() {
    const d = S.drag; if (!d) return;
    const dx = d.cx - d.sx, dy = d.cy - d.sy, mp = maxPull();
    const v = launchVelocity(dx, dy, mp), ready = dy > 24;
    ctx.strokeStyle = ready ? 'rgba(39,211,195,.9)' : 'rgba(255,255,255,.4)'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.setLineDash([2, 10]); ctx.beginPath(); ctx.moveTo(d.sx, d.sy); ctx.lineTo(d.cx, d.cy); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.beginPath(); ctx.arc(d.sx, d.sy, 8, 0, Math.PI * 2); ctx.fill();
    if (ready) {
      for (let i = 1; i <= 9; i++) {
        const t = i * 0.04;
        const p = P(BALL0.x + v.vx * t, BALL0.y + v.vy * t - 0.5 * G * t * t, BALL0.z + v.vz * t);
        ctx.fillStyle = `rgba(255,255,255,${0.85 - i * 0.08})`; ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(2, 5 - i * 0.3), 0, Math.PI * 2); ctx.fill();
      }
    }
    const bw = Math.min(180, W * 0.5), bx = (W - bw) / 2, by = H - 46 - (S.hintShown ? 0 : 38);
    ctx.fillStyle = 'rgba(255,255,255,.15)'; ctx.fillRect(bx, by, bw, 8);
    ctx.fillStyle = '#27d3c3'; ctx.fillRect(bx, by, bw * clamp(v.a / 1.15, 0, 1), 8);
  }

  function render() {
    drawBackground();
    drawTable();
    if (S.screen !== 'game' || !S.players.length) { drawIdleCups(); return; }
    FLIP = !!(S.live && S.cur !== S.live.me);
    const items = [];
    const addRack = (pl, mirror) => {
      for (const k of pl.cups) {
        const c = mirror ? { x: k.x, z: TABLE_L - k.z } : k, z = FLIP ? TABLE_L - c.z : c.z;
        if (!k.dead) items.push({ z, draw: () => drawCup(c, pl.drink, pl.team) });
        else if (k.t < 0.7) items.push({ z, draw: () => drawCup(c, pl.drink, pl.team, k.t * 0.5, 1 - k.t / 0.7, 1 + k.t * 0.3) });
      }
    };
    addRack(target(), false);
    if (S.mode === 'versus') addRack(S.players[S.cur], true);
    if (S.ballVisible) items.push({ z: FLIP ? TABLE_L - S.ball.z : S.ball.z, draw: () => drawBall(S.ball) });
    items.sort((a, b) => b.z - a.z);
    items.forEach((i) => i.draw());
    for (const p of S.particles) {
      const q = PV(p.x, p.y, p.z);
      ctx.globalAlpha = clamp(p.life, 0, 1); ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(q.x, q.y, Math.max(2, q.s * 0.012), 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
    }
    FLIP = false;
    if (S.phase === 'aim' && iAmThrower()) drawAim();
  }
  let idle = null, idleFor = '';
  function drawIdleCups() {
    if (idleFor !== settings.d1) { idle = makeRack(drinkById(settings.d1).cup); idleFor = settings.d1; }
    idle.forEach((c) => drawCup(c, drinkById(settings.d1), TEAM[0]));
  }

  // ---------- Loop ----------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000); last = now;
    update(dt); render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  showMenu();
  // arrive via a shared link like  …/genpong/#KQFT  -> open the Online tab with the code filled in
  const hashCode = (location.hash || '').replace('#', '').toUpperCase();
  if (/^[A-Z]{4}$/.test(hashCode)) { settings.mode = 'online'; refreshMenu(); $('#codeIn').value = hashCode; netStatus('Add your name and a drink, then tap Join.'); }

  // test hooks (harmless in production)
  window.__gp = { S, physStep, newBall, simulate, makeRack, launchVelocity, settings, throwBall, maxPull, alive, DRINKS, CUPS, drinkById, startLocalGame, drawCup, TEAM, P, resize, createGame, joinGame, ctx };
})();
