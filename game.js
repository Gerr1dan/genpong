'use strict';
/* Genpong Online – prototype. Static, no dependencies. */
(() => {
  const $ = (s) => document.querySelector(s);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ---------- Data ----------
  const DRINKS = [
    { id: 'beer', name: 'Beer', emoji: '🍺', color: '#e9a21b', foam: '#fff1c9' },
    { id: 'water', name: 'Water', emoji: '💧', color: '#8fd8ff' },
    { id: 'cola', name: 'Cola', emoji: '🥤', color: '#4a2412' },
    { id: 'oj', name: 'Orange juice', emoji: '🍊', color: '#ff9f1c' },
    { id: 'wine', name: 'Wine', emoji: '🍷', color: '#8e1b3a' },
    { id: 'bubbly', name: 'Bubbly', emoji: '🥂', color: '#f3e08a', foam: '#fffbe0' },
    { id: 'mocktail', name: 'Mocktail', emoji: '🍹', color: '#ff5fa2' },
  ];
  const drinkById = (id) => DRINKS.find((d) => d.id === id) || DRINKS[0];
  const CUP_COLORS = [
    { id: 'red', name: 'Red', a: '#b81c1c', b: '#ee3b3b', c: '#a01414', rim: '#ff7b7b', inside: '#5a0d0d' },
    { id: 'blue', name: 'Blue', a: '#1a3fa8', b: '#3b78f0', c: '#143088', rim: '#8fb4ff', inside: '#0b1a4a' },
    { id: 'green', name: 'Green', a: '#157a3c', b: '#2ecf6a', c: '#0f5e2e', rim: '#8ff0b3', inside: '#07301a' },
    { id: 'yellow', name: 'Yellow', a: '#c79a00', b: '#ffd23b', c: '#a87f00', rim: '#fff0a0', inside: '#5a4600' },
    { id: 'purple', name: 'Purple', a: '#5e2a9e', b: '#9b5de5', c: '#4a2080', rim: '#cdb0ff', inside: '#26104a' },
    { id: 'black', name: 'Black', a: '#15151c', b: '#3a3a48', c: '#0c0c12', rim: '#8a8aa0', inside: '#050508' },
  ];
  const cupById = (id) => CUP_COLORS.find((c) => c.id === id) || CUP_COLORS[0];

  // ---------- World (metres; table top is y=0, z runs away from the thrower) ----------
  const TABLE_W = 0.9, TABLE_L = 2.1;
  const CUP_H = 0.15, CUP_RT = 0.085, CUP_RB = 0.055;
  const BALL_R = 0.04, G = 9.8;
  const CAM = { x: 0, y: 1.0, z: -0.9 };
  const BALL0 = { x: 0, y: 0.45, z: 0.1 };
  const RACK_Z = 1.45;
  const THROW_ANGLE = (55 * Math.PI) / 180;
  const SOLO_THROWS = 15;

  // ---------- Canvas / projection ----------
  const canvas = $('#c');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, F = 1, HY = 0;
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

  // ---------- Pure physics (also used by the headless tuning test) ----------
  function launchVelocity(dx, dy, maxPull) {
    const a = clamp(dy / maxPull, 0, 1.15);
    const lat = clamp(-dx / maxPull, -1, 1);
    const speed = 2.2 + a * 3.2;
    return { vx: lat * 0.7, vy: speed * Math.sin(THROW_ANGLE), vz: speed * Math.cos(THROW_ANGLE), a };
  }

  function makeRack() {
    const cups = [], dx = CUP_RT * 2 * 1.04, dz = dx * 0.866;
    for (let r = 0; r < 4; r++)
      for (let i = 0; i <= r; i++) cups.push({ x: (i - r / 2) * dx, z: RACK_Z + r * dz, dead: false, t: 0 });
    return cups;
  }
  const alive = (cups) => cups.filter((c) => !c.dead);

  function newBall() {
    return { x: BALL0.x, y: BALL0.y, z: BALL0.z, vx: 0, vy: 0, vz: 0, bounces: 0, events: [], rest: 0 };
  }

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
        // outer wall (only below the rim)
        if (b.y > -BALL_R && d < CUP_RT + BALL_R) {
          b.x = c.x + hx * (CUP_RT + BALL_R); b.z = c.z + hz * (CUP_RT + BALL_R);
          const vn = b.vx * hx + b.vz * hz;
          if (vn < 0) { b.vx -= 1.5 * vn * hx; b.vz -= 1.5 * vn * hz; b.vx *= 0.85; b.vz *= 0.85; b.events.push('rim'); }
        }
      } else if (b.y < CUP_H + BALL_R + 0.02 && d < CUP_RT + BALL_R + 0.02) {
        // rim: sphere against a ring of radius CUP_RT at height CUP_H
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

  // headless simulation for tuning/tests
  function simulate(dx, dy, cups, maxPull = 300) {
    const v = launchVelocity(dx, dy, maxPull), b = newBall();
    b.vx = v.vx; b.vy = v.vy; b.vz = v.vz;
    for (let i = 0; i < 240 * 6; i++) {
      const r = physStep(b, cups, 1 / 240);
      if (r) return { ...r, bounced: b.bounces > 0, z: b.z };
    }
    return { type: 'timeout' };
  }

  // ---------- Game state ----------
  const S = {
    screen: 'menu', phase: 'idle', mode: 'solo', players: [], cur: 0,
    score: 0, streak: 0, throwsLeft: 0, throwsUsed: 0, cupsDown: 0,
    throwsThisTurn: 0, hitsThisTurn: 0,
    ball: newBall(), ballVisible: true, flightT: 0,
    drag: null, wait: 0, after: null, particles: [], hintShown: false,
  };
  const settings = Object.assign(
    { mode: 'solo', n1: '', d1: 'beer', c1: 'red', n2: '', d2: 'water', c2: 'blue' },
    JSON.parse(localStorage.getItem('genpong.settings') || '{}')
  );
  window.addEventListener('resize', resize);
  resize();
  const saveSettings = () => localStorage.setItem('genpong.settings', JSON.stringify(settings));
  const getBest = () => +(localStorage.getItem('genpong.best') || 0);

  const target = () => (S.mode === 'solo' ? S.players[0] : S.players[1 - S.cur]);
  const maxPull = () => Math.min(Math.min(W, H) * 0.8, 420);

  // ---------- Menu ----------
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
  function buildCupColors(el, key, other) {
    el.innerHTML = '<span class="lbl">Cups</span>';
    CUP_COLORS.forEach((c) => {
      const b = document.createElement('button');
      b.className = 'sw' + (settings[key] === c.id ? ' on' : '');
      b.title = c.name; b.setAttribute('aria-label', c.name + ' cups');
      b.style.background = `linear-gradient(90deg,${c.a},${c.b} 40%,${c.c})`;
      b.onclick = () => {
        settings[key] = c.id;
        if (settings.mode === 'versus' && settings.c1 === settings.c2) settings[other] = CUP_COLORS.find((x) => x.id !== c.id).id;
        saveSettings(); refreshMenu();
      };
      el.appendChild(b);
    });
  }
  function refreshMenu() {
    document.querySelectorAll('#modeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === settings.mode));
    $('#p2').hidden = settings.mode !== 'versus';
    $('#p1').querySelector('label').textContent = settings.mode === 'versus' ? 'Player 1' : 'Your name';
    $('#n1').value = settings.n1; $('#n2').value = settings.n2;
    buildDrinks($('#d1'), 'd1'); buildDrinks($('#d2'), 'd2');
    buildCupColors($('#k1'), 'c1', 'c2'); buildCupColors($('#k2'), 'c2', 'c1');
    const best = getBest();
    $('#best').textContent = best ? `Your solo best: ${best}` : '';
  }
  document.querySelectorAll('#modeSeg button').forEach((b) => {
    b.onclick = () => { settings.mode = b.dataset.mode; saveSettings(); refreshMenu(); };
  });
  $('#n1').oninput = (e) => { settings.n1 = e.target.value; saveSettings(); };
  $('#n2').oninput = (e) => { settings.n2 = e.target.value; saveSettings(); };
  $('#play').onclick = () => startGame();
  $('#menuBtn').onclick = () => showMenu();
  function setMuteIcon() { $('#muteBtn').textContent = muted ? '🔇' : '🔊'; }
  $('#muteBtn').onclick = () => { muted = !muted; localStorage.setItem('genpong.muted', muted ? '1' : '0'); setMuteIcon(); };
  setMuteIcon();

  function showMenu() {
    S.screen = 'menu'; S.phase = 'idle'; applyView();
    $('#menu').classList.remove('hidden'); $('#result').classList.add('hidden');
    $('#hud').classList.add('hidden'); $('#hint').classList.add('hidden');
    refreshMenu();
  }

  // ---------- Flow ----------
  function startGame() {
    S.mode = settings.mode;
    const p1 = { name: (settings.n1 || '').trim() || (S.mode === 'solo' ? 'You' : 'Player 1'), drink: drinkById(settings.d1), cup: cupById(settings.c1), cups: makeRack() };
    S.players = [p1];
    if (S.mode === 'versus')
      S.players.push({ name: (settings.n2 || '').trim() || 'Player 2', drink: drinkById(settings.d2),
        cup: cupById(settings.c2 === settings.c1 ? CUP_COLORS.find((x) => x.id !== settings.c1).id : settings.c2), cups: makeRack() });
    S.cur = 0; S.score = 0; S.streak = 0; S.cupsDown = 0; S.throwsUsed = 0; S.throwsLeft = SOLO_THROWS;
    S.throwsThisTurn = 0; S.hitsThisTurn = 0; S.particles = [];
    S.screen = 'game'; applyView();
    $('#menu').classList.add('hidden'); $('#result').classList.add('hidden'); $('#hud').classList.remove('hidden');
    if (!S.hintShown) $('#hint').classList.remove('hidden');
    if (S.mode === 'versus') banner(`${p1.name} starts!`, false);
    readyBall();
  }

  function readyBall() {
    S.ball = newBall(); S.ballVisible = true; S.phase = 'aim'; S.drag = null; updateHud();
  }

  function later(sec, fn) { S.wait = sec; S.after = fn; }

  function throwBall(dx, dy) {
    const v = launchVelocity(dx, dy, maxPull());
    const b = newBall(); b.vx = v.vx; b.vy = v.vy; b.vz = v.vz;
    S.ball = b; S.ballVisible = true; S.phase = 'flying'; S.flightT = 0;
    S.hintShown = true; $('#hint').classList.add('hidden');
    sfx.throw();
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

  function endThrow(res) {
    S.phase = 'resolving';
    const tgtOwner = target();
    const hit = res.type === 'sunk';
    const bounced = hit && S.ball.bounces > 0;
    if (hit) { S.ballVisible = false; spawnSplash(res.cup, tgtOwner.drink.color); sfx.sink(); } else sfx.miss();
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
    const me = S.players[S.cur], opp = S.players[1 - S.cur];
    S.throwsThisTurn++;
    if (hit) {
      S.hitsThisTurn++;
      removeCups(opp.cups, cup, bounced ? 2 : 1);
      banner(`${bounced ? 'BOUNCE! ' : ''}${opp.name} drinks ${opp.drink.emoji}`, false);
    } else banner('Miss!', true);
    updateHud();
    if (!alive(opp.cups).length) { sfx.win(); later(1.2, () => showResult(true, 0)); return; }
    if (S.throwsThisTurn >= 2) {
      const ballsBack = S.hitsThisTurn === 2;
      S.throwsThisTurn = 0; S.hitsThisTurn = 0;
      if (ballsBack) later(1.2, () => { banner(`BALLS BACK! ${me.name} again`, false); readyBall(); });
      else later(1.2, () => { S.cur = 1 - S.cur; banner(`${S.players[S.cur].name}'s turn`, false); readyBall(); });
    } else later(0.9, readyBall);
  }

  // ---------- HUD / banner / result ----------
  let bannerTimer = 0;
  function banner(text, miss) {
    const el = $('#banner');
    el.textContent = text; el.className = ''; void el.offsetWidth;
    el.className = 'show' + (miss ? ' miss' : '');
    clearTimeout(bannerTimer);
  }
  function updateHud() {
    const L = $('#hudL'), M = $('#hudM'), R = $('#hudR');
    if (S.mode === 'solo') {
      const me = S.players[0];
      L.className = 'hud-side'; R.innerHTML = '';
      L.innerHTML = `<small>${esc(me.name)}</small><span class="big">${S.score}</span>`;
      M.innerHTML = `${alive(me.cups).length} cups left<small>${S.throwsLeft} throws left${S.streak > 1 ? ' · 🔥 x' + S.streak : ''}</small>`;
    } else {
      const [a, b] = S.players;
      L.className = 'hud-side' + (S.cur === 0 ? ' active' : '');
      R.className = 'hud-side right' + (S.cur === 1 ? ' active' : '');
      L.innerHTML = `${a.drink.emoji} ${esc(a.name)}<small>${alive(a.cups).length} cups left</small>`;
      R.innerHTML = `${esc(b.name)} ${b.drink.emoji}<small>${alive(b.cups).length} cups left</small>`;
      M.innerHTML = `${esc(S.players[S.cur].name)}<small>Throw ${Math.min(S.throwsThisTurn + 1, 2)}/2</small>`;
    }
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

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
    } else {
      const w = S.players[S.cur], l = S.players[1 - S.cur];
      card.innerHTML = `
        <h2>${esc(w.name)} wins! 🏆</h2>
        <div class="sub">${esc(l.name)} drinks the rest ${l.drink.emoji} (or water. Water is fine.)</div>
        <div class="stats"><div><b>${alive(w.cups).length}</b><span>${esc(w.name)}'s cups left</span></div>
        <div><b>${S.throwsUsed}</b><span>Total throws</span></div></div>
        <button class="primary" id="again">Rematch</button>
        <button class="secondary" id="toMenu">Menu</button>`;
    }
    $('#again').onclick = startGame;
    $('#toMenu').onclick = showMenu;
    $('#result').classList.remove('hidden');
  }
  function copyText(text, btn) {
    const done = () => { const o = btn.textContent; btn.textContent = 'Copied! Paste it in Teams ✅'; setTimeout(() => (btn.textContent = o), 2200); };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
    else fallbackCopy(text, done);
  }
  function fallbackCopy(text, done) {
    const ta = $('#shareText'); ta.focus(); ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { /* user can long-press */ }
  }

  // ---------- Input ----------
  canvas.addEventListener('pointerdown', (e) => {
    if (S.phase !== 'aim' || S.screen !== 'game') return;
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
      const n = Math.max(1, Math.ceil(dt / (1 / 240))), h = dt / n, cups = alive(target().cups);
      for (let i = 0; i < n; i++) {
        const b = S.ball, r = physStep(b, cups, h);
        for (const ev of b.events.splice(0)) (ev === 'bounce' ? sfx.bounce : sfx.rim)();
        if (r) { endThrow(r); break; }
        const sp = Math.hypot(b.vx, b.vz);
        b.rest = b.y <= BALL_R + 1e-3 && sp < 0.25 ? b.rest + h : 0;
        if (b.rest > 0.4) { endThrow({ type: 'miss' }); break; }
      }
      S.flightT += dt;
      if (S.phase === 'flying' && S.flightT > 6) endThrow({ type: 'miss' });
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
    // spotlight
    const sp = P(0, 0, TABLE_L * 0.8);
    const rg = ctx.createRadialGradient(sp.x, sp.y, 10, sp.x, sp.y, F * 0.9);
    rg.addColorStop(0, 'rgba(120,170,255,.28)'); rg.addColorStop(1, 'rgba(120,170,255,0)');
    ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
  }

  function drawTable() {
    const c = [P(-TABLE_W / 2, 0, 0), P(TABLE_W / 2, 0, 0), P(TABLE_W / 2, 0, TABLE_L), P(-TABLE_W / 2, 0, TABLE_L)];
    // dark under-glow
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 18;
    ctx.beginPath(); c.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath();
    const g = ctx.createLinearGradient(0, c[3].y, 0, Math.min(c[0].y, H));
    g.addColorStop(0, '#1f9c92'); g.addColorStop(1, '#14766f');
    ctx.fillStyle = g; ctx.fill(); ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = Math.max(2, F * 0.004); ctx.stroke();
    // centre line and end lines
    ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = Math.max(1, F * 0.0025);
    const a = P(0, 0, 0), b = P(0, 0, TABLE_L);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    const l1 = P(-TABLE_W / 2, 0, TABLE_L / 2), l2 = P(TABLE_W / 2, 0, TABLE_L / 2);
    ctx.beginPath(); ctx.moveTo(l1.x, l1.y); ctx.lineTo(l2.x, l2.y); ctx.stroke();
    // table thickness at the far end (a lip we can see from above)
    const t1 = P(-TABLE_W / 2, 0, TABLE_L), t2 = P(TABLE_W / 2, 0, TABLE_L);
    ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fillRect(t1.x, t1.y - 2, t2.x - t1.x, 3);
  }

  function ellipse(x, y, rx, ry) { ctx.beginPath(); ctx.ellipse(x, y, Math.max(rx, 0.1), Math.max(ry, 0.1), 0, 0, Math.PI * 2); }

  function drawCup(c, drink, cup, lift = 0, alpha = 1, scale = 1) {
    const rAt = (h) => CUP_RB + ((CUP_RT - CUP_RB) * h) / CUP_H;
    const pb = P(c.x, lift, c.z), pt = P(c.x, lift + CUP_H, c.z);
    const rb = CUP_RB * pb.s * scale, rt = CUP_RT * pt.s * scale;
    const ryb = (rb * (CAM.y - lift)) / pb.dz, ryt = (rt * (CAM.y - lift - CUP_H)) / pt.dz;
    ctx.save(); ctx.globalAlpha = alpha;
    // shadow
    if (lift === 0) { ctx.fillStyle = 'rgba(0,0,0,.28)'; ellipse(pb.x + rb * 0.25, pb.y + ryb * 0.3, rt * 1.05, ryb * 1.4); ctx.fill(); }
    // body
    ctx.beginPath();
    ctx.moveTo(pt.x - rt, pt.y); ctx.lineTo(pb.x - rb, pb.y);
    ctx.ellipse(pb.x, pb.y, rb, ryb, 0, Math.PI, 0, true);
    ctx.lineTo(pt.x + rt, pt.y); ctx.closePath();
    const bg = ctx.createLinearGradient(pt.x - rt, 0, pt.x + rt, 0);
    bg.addColorStop(0, cup.a); bg.addColorStop(0.35, cup.b); bg.addColorStop(1, cup.c);
    ctx.fillStyle = bg; ctx.fill();
    // white band
    const m1 = P(c.x, lift + CUP_H * 0.45, c.z), m2 = P(c.x, lift + CUP_H * 0.62, c.z);
    const r1 = rAt(CUP_H * 0.45) * m1.s * scale, r2 = rAt(CUP_H * 0.62) * m2.s * scale;
    ctx.beginPath(); ctx.moveTo(m2.x - r2, m2.y); ctx.lineTo(m1.x - r1, m1.y);
    ctx.lineTo(m1.x + r1, m1.y); ctx.lineTo(m2.x + r2, m2.y); ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,.88)'; ctx.fill();
    // inside
    ctx.fillStyle = cup.inside; ellipse(pt.x, pt.y, rt, ryt); ctx.fill();
    // liquid
    const lp = P(c.x, lift + CUP_H * 0.86, c.z), lr = rAt(CUP_H * 0.86) * lp.s * 0.96 * scale;
    ctx.fillStyle = drink.color; ellipse(lp.x, lp.y, lr, (lr * (CAM.y - lift - CUP_H * 0.86)) / lp.dz); ctx.fill();
    if (drink.foam) { ctx.fillStyle = drink.foam; ctx.globalAlpha = alpha * 0.8; ellipse(lp.x, lp.y - 0.5, lr * 0.85, (lr * 0.85 * (CAM.y - CUP_H)) / lp.dz); ctx.fill(); ctx.globalAlpha = alpha; }
    ctx.fillStyle = 'rgba(255,255,255,.22)'; ellipse(lp.x - lr * 0.25, lp.y - 0.5, lr * 0.45, (lr * 0.2 * (CAM.y - CUP_H)) / lp.dz); ctx.fill();
    // rim
    ctx.strokeStyle = cup.rim; ctx.lineWidth = Math.max(1.5, rt * 0.09); ellipse(pt.x, pt.y, rt, ryt); ctx.stroke();
    ctx.restore();
  }

  function drawBall(b) {
    const p = P(b.x, b.y, b.z), r = Math.max(BALL_R * p.s, 2.5);
    if (b.y >= 0 && b.z >= 0 && b.z <= TABLE_L && Math.abs(b.x) <= TABLE_W / 2) {
      const sh = P(b.x, 0, b.z), k = clamp(1 - b.y * 0.8, 0.25, 1);
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
    // pull line
    ctx.strokeStyle = ready ? 'rgba(39,211,195,.9)' : 'rgba(255,255,255,.4)'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.setLineDash([2, 10]); ctx.beginPath(); ctx.moveTo(d.sx, d.sy); ctx.lineTo(d.cx, d.cy); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.beginPath(); ctx.arc(d.sx, d.sy, 8, 0, Math.PI * 2); ctx.fill();
    // preview of the first part of the arc
    if (ready) {
      for (let i = 1; i <= 9; i++) {
        const t = i * 0.04;
        const p = P(BALL0.x + v.vx * t, BALL0.y + v.vy * t - 0.5 * G * t * t, BALL0.z + v.vz * t);
        ctx.fillStyle = `rgba(255,255,255,${0.85 - i * 0.08})`; ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(2, 5 - i * 0.3), 0, Math.PI * 2); ctx.fill();
      }
    }
    // power bar
    const bw = Math.min(180, W * 0.5), bx = (W - bw) / 2, by = H - 46 - (S.hintShown ? 0 : 38);
    ctx.fillStyle = 'rgba(255,255,255,.15)'; ctx.fillRect(bx, by, bw, 8);
    ctx.fillStyle = '#27d3c3'; ctx.fillRect(bx, by, bw * clamp(v.a / 1.15, 0, 1), 8);
  }

  function render() {
    drawBackground();
    drawTable();
    if (S.screen !== 'game' || !S.players.length) { drawIdleCups(); return; }
    const owner = target(), items = [];
    const addRack = (pl, mirror) => {
      for (const k of pl.cups) {
        const c = mirror ? { x: k.x, z: TABLE_L - k.z } : k;
        if (!k.dead) items.push({ z: c.z, draw: () => drawCup(c, pl.drink, pl.cup) });
        else if (k.t < 0.7) items.push({ z: c.z, draw: () => drawCup(c, pl.drink, pl.cup, k.t * 0.5, 1 - k.t / 0.7, 1 + k.t * 0.3) });
      }
    };
    addRack(owner, false);
    if (S.mode === 'versus') addRack(S.players[S.cur], true);
    if (S.ballVisible) items.push({ z: S.ball.z, draw: () => drawBall(S.ball) });
    items.sort((a, b) => b.z - a.z);
    items.forEach((i) => i.draw());
    for (const p of S.particles) {
      const q = P(p.x, p.y, p.z);
      ctx.globalAlpha = clamp(p.life, 0, 1); ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(q.x, q.y, Math.max(2, q.s * 0.012), 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
    }
    if (S.phase === 'aim') drawAim();
  }
  const idleRack = makeRack();
  function drawIdleCups() { idleRack.forEach((c) => drawCup(c, drinkById(settings.d1), cupById(settings.c1))); }

  // ---------- Loop ----------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000); last = now;
    update(dt); render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  showMenu();

  // test hooks (harmless in production)
  window.__gp = { S, physStep, newBall, simulate, makeRack, launchVelocity, startGame, settings, throwBall, maxPull, alive };
})();
