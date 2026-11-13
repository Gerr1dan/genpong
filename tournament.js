'use strict';
/* GenPong 2025 tournament, online edition.
   The organizer's device is the referee: it keeps the tournament state, applies results and broadcasts the state
   (as a retained MQTT message, so late joiners and reloads catch up instantly). Players send it their scores/results.
   Format (from "The rules of GenPong 2025", adapted to 1v1 on your own device):
     1. Elimination round: everyone throws 8 balls at a full rack; score = cups taken out.
     2. Ladder: ranked by cups. The top 8 (or 4/2 with fewer players) go to the knockout rounds.
        Ties on the cut line go to a 2-ball sudden death (repeated until settled).
     3. Quarter-finals and semi-finals: clear the other side's cups, or most cups hit after 10 minutes.
        Final: no time limit. Every knockout match starts with best-of-3 rock-paper-scissors. */
(() => {
  const GP = window.GP, Live = window.GenpongLive, cfg = window.GENPONG_CONFIG || {};
  const $ = (s) => document.querySelector(s), esc = GP.esc;
  const ELIM_BALLS = 8, SD_BALLS = 2, KO_TIME = 600;
  let chan = null, T = null, isOrg = false, code = null, myPid = null, timers = [], dirty = false, joinTries = 0;

  const pidKey = (c) => 'genpong.tour.' + c + '.pid';
  const orgKey = (c) => 'genpong.tour.org.' + c;
  const status = (t, bad) => { const el = $('#tourStatus'); el.textContent = t || ''; el.style.color = bad ? '#ff8a8a' : ''; };
  const getPid = (c) => { let p = localStorage.getItem(pidKey(c)); if (!p) { p = 'p' + Math.random().toString(36).slice(2, 10); localStorage.setItem(pidKey(c), p); } return p; };
  const P = (pid) => (T && T.players[pid]) || { name: '?', drink: 'water' };
  const emoji = (pid) => GP.drinkById(P(pid).drink).emoji;
  const linkFor = (c) => location.href.split('#')[0] + '#t=' + c;

  // ---------- entering / leaving ----------
  async function create() {
    if (!cfg.organizerHash) return status('Tournaments are not set up (no organizer passphrase configured).', true);
    if ((await GP.hashStr($('#tourPass').value.trim())) !== cfg.organizerHash) return status('Wrong organizer passphrase.', true);
    const c = GP.newCode(5);
    T = { code: c, v: 0, phase: 'lobby', created: Date.now(), players: {}, order: [], sd: null, rounds: [], champion: null };
    isOrg = true; code = c; myPid = null;
    if ($('#tourAlsoPlay').checked) { myPid = getPid(c); addPlayer(myPid, GP.profile()); }
    localStorage.setItem('genpong.tour.orgActive', c);
    await connect();
  }
  async function join(c) {
    c = (c || $('#tourCodeIn').value || '').toUpperCase().replace(/[^A-Z]/g, '');
    if (c.length !== 5) return status('Enter the 5-letter tournament code.', true);
    if (localStorage.getItem(orgKey(c))) return resume(c); // it's my own tournament
    isOrg = false; code = c; myPid = getPid(c); T = null; joinTries = 0;
    localStorage.setItem('genpong.tour.lastCode', c);
    await connect();
  }
  async function resume(c) {
    c = c || localStorage.getItem('genpong.tour.orgActive');
    const saved = c && localStorage.getItem(orgKey(c));
    if (!saved) return status('Nothing to resume.', true);
    T = JSON.parse(saved); isOrg = true; code = c; myPid = localStorage.getItem(pidKey(c));
    await connect();
  }
  async function connect() {
    status('Connecting…');
    try { chan = await Live.join('t/' + code, onMsg, null, {}); } catch (e) { chan = null; return status('Could not reach the game server. Check your connection and try again.', true); }
    status('');
    timers.forEach(clearInterval); timers = [];
    if (isOrg) {
      broadcast();
      timers.push(setInterval(() => { if (dirty) broadcast(); }, 1500));
      timers.push(setInterval(broadcast, 10000)); // refreshes "online" dots and the retained copy
    } else {
      const hello = () => {
        if (T && (T.players[myPid] || !['lobby', 'elim'].includes(T.phase))) return; // joined, or spectating
        if (joinTries++ > 6 && !T) { leave(); return status(`No tournament found with code ${code}.`, true); }
        chan.send({ t: 'tjoin', pid: myPid, p: GP.profile() });
      };
      hello(); timers.push(setInterval(hello, 2000));
      timers.push(setInterval(() => chan && chan.send({ t: 'tping', pid: myPid }), 5000));
    }
    show();
  }
  function leave() {
    timers.forEach(clearInterval); timers = [];
    if (chan) { chan.close(false); chan = null; }
    T = null; isOrg = false; code = null;
    $('#tour').classList.add('hidden');
    GP.showMenu();
  }
  function show() { if (GP.busy()) return; $('#menu').classList.add('hidden'); $('#tour').classList.remove('hidden'); render(); }
  const submit = (m) => { m.pid = myPid; if (isOrg) orgHandle(m); else if (chan) chan.send(m); };

  // ---------- organizer: state & rules ----------
  function addPlayer(pid, prof) {
    const name = String(prof.name || '').trim().slice(0, 16) || 'Player ' + (T.order.length + 1);
    if (!T.players[pid]) {
      let n = name, k = 2; while (Object.values(T.players).some((p) => p.name === n)) n = `${name} (${k++})`;
      T.players[pid] = { name: n, drink: prof.drink || 'water', elim: null, sd: [], seen: Date.now(), joined: T.order.length };
      T.order.push(pid);
    } else { T.players[pid].drink = prof.drink || T.players[pid].drink; T.players[pid].seen = Date.now(); }
  }
  function broadcast() {
    if (!isOrg || !T) return;
    const now = Date.now();
    for (const pid of T.order) { const p = T.players[pid]; p.on = pid === myPid || now - p.seen < 20000; }
    T.v++; dirty = false;
    localStorage.setItem(orgKey(code), JSON.stringify(T));
    if (chan) chan.send({ t: 'tstate', s: T }, { retain: true });
    render();
  }
  const changed = () => { dirty = true; render(); };
  function orgHandle(m) {
    const p = T.players[m.pid];
    if (m.t === 'tjoin') {
      if (p || ['lobby', 'elim'].includes(T.phase)) { addPlayer(m.pid, m.p || {}); broadcast(); }
    } else if (m.t === 'tping') { if (p) p.seen = Date.now(); }
    else if (m.t === 'tscore' && p) {
      const cups = Math.max(0, Math.min(10, m.cups | 0));
      if (m.kind === 'elim' && T.phase === 'elim' && p.elim == null) { p.elim = cups; broadcast(); }
      if (m.kind === 'sd' && T.phase === 'sd' && T.sd.players.includes(m.pid) && T.sd.scores[m.pid] == null) {
        T.sd.scores[m.pid] = cups;
        if (T.sd.players.every((q) => T.sd.scores[q] != null)) closeSd(); else broadcast();
      }
    } else if (m.t === 'tprogress') {
      const mt = findMatch(m.mid);
      if (mt && !mt.winner && (m.pid === mt.a || m.pid === mt.b) && Array.isArray(m.hits)) { mt.hits = m.hits.slice(0, 2); mt.live = true; changed(); }
    } else if (m.t === 'tresult') {
      const mt = findMatch(m.mid);
      if (mt && !mt.winner && (m.pid === mt.a || m.pid === mt.b) && (m.winner === mt.a || m.winner === mt.b)) setWinner(mt, m.winner, m.hits);
    }
  }
  const key = (pid) => [T.players[pid].elim || 0, ...T.players[pid].sd];
  function cmp(a, b) {
    const ka = key(a), kb = key(b);
    for (let i = 0; i < Math.max(ka.length, kb.length); i++) { const d = (kb[i] || 0) - (ka[i] || 0); if (d) return d; }
    return T.players[a].joined - T.players[b].joined;
  }
  const sameKey = (a, b) => { const ka = key(a), kb = key(b); return ka.length === kb.length && ka.every((v, i) => v === kb[i]); };
  const ranking = () => T.order.slice().sort(cmp);
  const slots = (n) => (n >= 8 ? 8 : n >= 4 ? 4 : 2);

  function startElim() { T.phase = 'elim'; broadcast(); }
  function closeElim() {
    for (const pid of T.order) if (T.players[pid].elim == null) { T.players[pid].elim = 0; T.players[pid].dns = true; }
    computeCut();
  }
  function computeCut() {
    const r = ranking(), Q = slots(r.length);
    if (r.length < 2) { T.phase = 'done'; T.champion = r[0] || null; return broadcast(); }
    if (r.length > Q && sameKey(r[Q - 1], r[Q])) {
      const group = r.filter((pid) => sameKey(pid, r[Q - 1]));
      T.sd = { players: group, round: (T.sdRounds = (T.sdRounds || 0) + 1), scores: {}, spots: Q - r.indexOf(group[0]) };
      T.phase = 'sd';
      return broadcast();
    }
    startKO(r.slice(0, Q));
  }
  function closeSd() {
    for (const pid of T.sd.players) T.players[pid].sd.push(T.sd.scores[pid] == null ? 0 : T.sd.scores[pid]);
    // everyone outside the tie group gets a 0 placeholder so key lengths stay comparable
    for (const pid of T.order) if (!T.sd.players.includes(pid)) T.players[pid].sd.push(-1);
    T.sd = null; computeCut();
  }
  function coinFlip() {
    const g = T.sd.players.slice().sort(() => Math.random() - 0.5);
    g.forEach((pid, i) => { T.players[pid].sd.push(1000 - i); T.players[pid].coin = true; }); // values >= 100 = random draw
    for (const pid of T.order) if (!g.includes(pid)) T.players[pid].sd.push(-1);
    T.sd = null; computeCut();
  }
  function startKO(seeds) {
    const Q = seeds.length, pairs = { 8: [[0, 7], [3, 4], [1, 6], [2, 5]], 4: [[0, 3], [1, 2]], 2: [[0, 1]] }[Q];
    T.rounds = []; T.seeds = seeds;
    for (let size = Q, r = 0; size >= 2; size /= 2, r++) {
      T.rounds.push({ name: size === 8 ? 'Quarter-final' : size === 4 ? 'Semi-final' : 'Final',
        matches: Array.from({ length: size / 2 }, (_, i) => ({ id: `r${r}m${i}`, a: null, b: null, winner: null, hits: [0, 0], room: null, time: size === 2 ? 0 : KO_TIME })) });
    }
    pairs.forEach(([x, y], i) => { const m = T.rounds[0].matches[i]; m.a = seeds[x]; m.b = seeds[y]; m.room = GP.newCode(); });
    T.phase = 'ko'; broadcast();
  }
  function findMatch(id) { for (const r of T.rounds) for (const m of r.matches) if (m.id === id) return m; return null; }
  function where(id) { for (let r = 0; r < T.rounds.length; r++) { const i = T.rounds[r].matches.findIndex((m) => m.id === id); if (i >= 0) return [r, i]; } return null; }
  function setWinner(m, pid, hits) {
    m.winner = pid; m.live = false; if (Array.isArray(hits)) m.hits = hits.slice(0, 2);
    const [r, i] = where(m.id);
    if (r === T.rounds.length - 1) { T.champion = pid; T.phase = 'done'; }
    else {
      const next = T.rounds[r + 1].matches[Math.floor(i / 2)];
      next[i % 2 === 0 ? 'a' : 'b'] = pid;
      if (next.a && next.b && !next.room) next.room = GP.newCode();
    }
    broadcast();
  }
  function resetMatch(m) {
    const [r, i] = where(m.id);
    if (m.winner && r < T.rounds.length - 1) {
      const next = T.rounds[r + 1].matches[Math.floor(i / 2)];
      if (next.winner) return alert('The next match is already decided. Reset that one first.');
      next[i % 2 === 0 ? 'a' : 'b'] = null; next.room = null;
    }
    if (T.phase === 'done') { T.phase = 'ko'; T.champion = null; }
    m.winner = null; m.hits = [0, 0]; m.live = false; m.room = GP.newCode(); // fresh room so both players start clean
    broadcast();
  }

  // ---------- players: messages ----------
  function onMsg(m) {
    if (isOrg) return orgHandle(m);
    if (m.t === 'tstate' && m.s && (!T || m.s.v >= T.v || m.s.created !== T.created)) { T = m.s; render(); }
  }

  // ---------- playing ----------
  function playElim() {
    const k = 'genpong.tour.' + code + '.started.elim';
    if (localStorage.getItem(k) && !confirm('You already started your elimination round. Restarting is on your honour. Continue?')) return;
    localStorage.setItem(k, '1');
    GP.startShootout({ balls: ELIM_BALLS, title: `Elimination round: ${ELIM_BALLS} balls`, onDone: (cups) => submit({ t: 'tscore', kind: 'elim', cups }), onExit: show });
  }
  function playSd() {
    GP.startShootout({ balls: SD_BALLS, title: `Sudden death: ${SD_BALLS} balls!`, doneText: 'Sudden-death score submitted.', onDone: (cups) => submit({ t: 'tscore', kind: 'sd', cups }), onExit: show });
  }
  function playKo(m) {
    const rName = T.rounds[where(m.id)[0]].name;
    GP.playMatch({
      room: m.room + m.id, me: m.a === myPid ? 0 : 1,
      profs: [{ name: P(m.a).name, drink: P(m.a).drink }, { name: P(m.b).name, drink: P(m.b).drink }],
      rules: Object.assign({}, GP.RULES_GENPONG, { timeLimit: m.time }),
      hooks: {
        exit: show,
        error: () => { show(); alert('Could not reach the game server. Try again.'); },
        end: (w, hits) => submit({ t: 'tresult', mid: m.id, winner: w === 0 ? m.a : m.b, hits }),
        progress: (hits) => submit({ t: 'tprogress', mid: m.id, hits }),
      },
      title: rName,
    });
  }
  function myMatch() {
    if (!T || T.phase !== 'ko' || !myPid) return null;
    for (const r of T.rounds) for (const m of r.matches) if (!m.winner && m.a && m.b && (m.a === myPid || m.b === myPid)) return m;
    return null;
  }

  // ---------- rendering ----------
  const PHASE = { lobby: 'Lobby: waiting to start', elim: 'Elimination round', sd: 'Sudden death', ko: 'Knockout rounds', done: 'Finished' };
  function render() {
    const card = $('#tourCard'); if (!card) return;
    if (!T) { card.innerHTML = `<h2>Tournament ${esc(code || '')}</h2><p class="sub">Connecting to the organizer…</p><button class="secondary" id="tLeave">Leave</button>`; $('#tLeave').onclick = leave; return; }
    const me = myPid && T.players[myPid];
    let action = '';
    if (T.phase === 'lobby') action = me ? `<p>You're in! Waiting for the organizer to start the elimination round.</p>` : `<p>The tournament has started without you. You can still watch.</p>`;
    else if (T.phase === 'elim') {
      if (!me) action = '<p>Watching the elimination round.</p>';
      else if (me.elim == null) action = `<p>Throw ${ELIM_BALLS} balls. Every cup counts.</p><button class="primary" id="tPlayElim">🎯 Throw your ${ELIM_BALLS} balls</button>`;
      else action = `<p>Your score: <b>${me.elim}</b> cup${me.elim === 1 ? '' : 's'}. Waiting for the others…</p>`;
    } else if (T.phase === 'sd') {
      const inSd = me && T.sd.players.includes(myPid);
      if (inSd && T.sd.scores[myPid] == null) action = `<p><b>Sudden death!</b> You're tied on the cut line. Throw ${SD_BALLS} balls. ${T.sd.spots} spot${T.sd.spots === 1 ? '' : 's'} left.</p><button class="primary" id="tPlaySd">⚡ Throw ${SD_BALLS} balls</button>`;
      else action = `<p>Sudden death between ${T.sd.players.map((p) => esc(P(p).name)).join(', ')} for ${T.sd.spots} spot${T.sd.spots === 1 ? '' : 's'}.</p>`;
    } else if (T.phase === 'ko') {
      const m = myMatch();
      if (m) { const opp = m.a === myPid ? m.b : m.a; action = `<p>${T.rounds[where(m.id)[0]].name} vs <b>${esc(P(opp).name)}</b> ${emoji(opp)}${m.time ? ' · 10 min' : ' · no time limit'}</p><button class="primary" id="tPlayKo">▶ Play your match</button>`; }
      else if (me && T.seeds.includes(myPid) && !isOut(myPid)) action = '<p>Waiting for your next opponent…</p>';
      else action = `<p>${me ? "You're out, but the bar is still open 😉 Watch the bracket!" : 'Watching the knockout rounds.'}</p>`;
    } else if (T.phase === 'done') action = T.champion ? `<div class="champ">🏆<div><b>${esc(P(T.champion).name)}</b> is the GenPong Online champion!</div></div>` : '<p>Tournament finished.</p>';

    card.innerHTML = `
      <h2>🏆 GenPong Online</h2>
      <div class="sub">Tournament <b class="tcode">${esc(T.code)}</b> · ${PHASE[T.phase]}${isOrg ? ' · <span class="orgtag">organizer</span>' : ''}</div>
      <div class="taction">${action}</div>
      ${isOrg ? orgPanel() : ''}
      ${T.phase === 'ko' || T.phase === 'done' ? bracketHtml() : ''}
      ${ladderHtml()}
      <button class="secondary" id="tLeave">${isOrg ? 'Close (tournament pauses)' : 'Leave tournament'}</button>`;
    const on = (id, fn) => { const el = $('#' + id); if (el) el.onclick = fn; };
    on('tPlayElim', playElim); on('tPlaySd', playSd); on('tPlayKo', () => playKo(myMatch()));
    on('tLeave', () => { if (!isOrg || confirm('You are the referee. Closing pauses the tournament until you resume it from the Tournament tab. Close?')) leave(); });
    on('tStartElim', startElim); on('tCloseElim', () => confirm('Close the elimination round? Anyone who has not thrown gets 0.') && closeElim());
    on('tCloseSd', () => closeSd());
    on('tCoin', () => { if (confirm('Rank the tied players at random?')) coinFlip(); });
    on('tCopy', () => copy(linkFor(T.code), $('#tCopy')));
    on('tResults', () => copy(resultsText(), $('#tResults')));
    on('tEnd', () => { if (confirm('End and delete this tournament?')) { chan && chan.clearRetained(); localStorage.removeItem(orgKey(code)); localStorage.removeItem('genpong.tour.orgActive'); leave(); } });
    card.querySelectorAll('[data-kick]').forEach((b) => (b.onclick = () => { if (confirm('Remove ' + P(b.dataset.kick).name + '?')) { delete T.players[b.dataset.kick]; T.order = T.order.filter((p) => p !== b.dataset.kick); broadcast(); } }));
    card.querySelectorAll('[data-win]').forEach((b) => (b.onclick = () => { const [mid, pid] = b.dataset.win.split('|'); const m = findMatch(mid); if (m && confirm(`Award this match to ${P(pid).name}?`)) setWinner(m, pid); }));
    card.querySelectorAll('[data-reset]').forEach((b) => (b.onclick = () => { const m = findMatch(b.dataset.reset); if (m && confirm('Reset this match? Both players start it again from scratch.')) resetMatch(m); }));
  }
  const isOut = (pid) => T.rounds.some((r) => r.matches.some((m) => m.winner && (m.a === pid || m.b === pid) && m.winner !== pid));
  function orgPanel() {
    let b = '';
    const n = T.order.length;
    if (T.phase === 'lobby') b = `<button class="primary" id="tStartElim" ${n < 2 ? 'disabled' : ''}>Start elimination round (${n} player${n === 1 ? '' : 's'})</button>`;
    if (T.phase === 'elim') { const done = T.order.filter((p) => T.players[p].elim != null).length; b = `<button class="primary" id="tCloseElim">Close elimination round (${done}/${n} done)</button>`; }
    if (T.phase === 'sd') {
      const done = T.sd.players.filter((p) => T.sd.scores[p] != null).length;
      b = `<button class="primary" id="tCloseSd">Close sudden death now (${done}/${T.sd.players.length} done)</button>
        ${T.sd.round > 1 ? '<button class="secondary" id="tCoin">Still tied? Break the tie at random 🎲</button>' : ''}`;
    }
    return `<div class="orgpanel">
      <div class="small dim">Invite players: send them this link or the code <b>${esc(T.code)}</b></div>
      <input class="linkbox" readonly value="${esc(linkFor(T.code))}">
      <div class="row2"><button class="secondary" id="tCopy">Copy invite link</button><button class="secondary" id="tResults">Copy results</button></div>
      ${b}
      ${T.phase === 'done' || T.phase === 'ko' ? '<button class="secondary danger" id="tEnd">End tournament</button>' : ''}
    </div>`;
  }
  function ladderHtml() {
    const r = ranking(), Q = T.seeds ? T.seeds.length : slots(r.length);
    const rows = r.map((pid, i) => {
      const p = T.players[pid], q = T.seeds ? T.seeds.includes(pid) : false, sd = p.sd.filter((x) => x >= 0 && x < 100);
      return `<tr class="${pid === myPid ? 'me' : ''} ${q ? 'q' : ''}">
        <td>${i + 1}</td><td><span class="dot ${p.on ? 'on' : ''}"></span>${esc(p.name)} ${GP.drinkById(p.drink).emoji}</td>
        <td class="num">${p.elim == null ? (T.phase === 'elim' ? '…' : '–') : p.elim}${sd.length ? ` <small>(SD ${sd.join(', ')})</small>` : ''}${p.coin ? ' <small>🎲</small>' : ''}</td>
        <td>${q ? '✅' : ''}${isOrg && ['lobby', 'elim'].includes(T.phase) && pid !== myPid ? ` <button class="x" data-kick="${pid}" title="Remove">×</button>` : ''}</td></tr>`;
    }).join('');
    return `<h3>Ladder</h3><div class="small dim">Top ${Q} go through to the knockout rounds</div>
      <table class="ladder"><thead><tr><th>#</th><th>Player</th><th class="num">Cups</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="dim">No players yet</td></tr>'}</tbody></table>`;
  }
  function bracketHtml() {
    const name = (pid) => (pid ? `${esc(P(pid).name)} ${emoji(pid)}` : '<span class="dim">TBD</span>');
    return `<h3>Bracket</h3><div class="bracket">${T.rounds.map((r) => `<div class="bcol"><div class="bhead">${r.name}</div>${r.matches.map((m) => `
      <div class="bmatch ${m.live && !m.winner ? 'live' : ''}">
        <div class="${m.winner === m.a ? 'win' : ''}"><span>${name(m.a)}</span><b>${m.a && m.b ? m.hits[0] : ''}</b></div>
        <div class="${m.winner === m.b ? 'win' : ''}"><span>${name(m.b)}</span><b>${m.a && m.b ? m.hits[1] : ''}</b></div>
        ${m.live && !m.winner ? '<em>LIVE</em>' : ''}
        ${isOrg && m.a && m.b ? `<div class="borg">${m.winner ? '' : `<button data-win="${m.id}|${m.a}">${esc(P(m.a).name)} wins</button><button data-win="${m.id}|${m.b}">${esc(P(m.b).name)} wins</button>`}<button data-reset="${m.id}">Reset</button></div>` : ''}
      </div>`).join('')}</div>`).join('')}</div>`;
  }
  function resultsText() {
    const lines = [`🏆 GenPong Online tournament ${T.code}`];
    if (T.champion) lines.push(`Champion: ${P(T.champion).name}`);
    for (const r of T.rounds) for (const m of r.matches) if (m.a && m.b) lines.push(`${r.name}: ${P(m.a).name} ${m.hits[0]}–${m.hits[1]} ${P(m.b).name}${m.winner ? ` → ${P(m.winner).name}` : ''}`);
    lines.push('Elimination ladder:'); ranking().forEach((pid, i) => lines.push(`${i + 1}. ${P(pid).name}: ${T.players[pid].elim ?? '-'} cups`));
    return lines.join('\n');
  }
  function copy(text, btn) {
    const done = () => { const o = btn.textContent; btn.textContent = 'Copied ✅'; setTimeout(() => (btn.textContent = o), 2000); };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, () => prompt('Copy this:', text));
    else prompt('Copy this:', text);
  }

  // ---------- menu wiring ----------
  $('#tourCreateBtn').onclick = create;
  $('#tourJoinBtn').onclick = () => join();
  $('#tourCodeIn').oninput = (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ''); };
  function refreshResume() {
    const org = localStorage.getItem('genpong.tour.orgActive'), last = localStorage.getItem('genpong.tour.lastCode');
    const b = $('#tourResume');
    if (chan && code) { b.hidden = false; b.textContent = `Back to tournament ${code}`; b.onclick = show; }
    else if (org && localStorage.getItem(orgKey(org))) { b.hidden = false; b.textContent = `Resume my tournament ${org} (organizer)`; b.onclick = () => resume(org); }
    else if (last) { b.hidden = false; b.textContent = `Rejoin tournament ${last}`; b.onclick = () => join(last); }
    else b.hidden = true;
  }
  window.onGenpongMenu = refreshResume; // keep the resume button fresh whenever the menu is shown
  document.querySelectorAll('#modeSeg button').forEach((b) => b.addEventListener('click', refreshResume));
  refreshResume();
  // invite link: …/#t=ABCDE
  const m = (location.hash || '').match(/^#t=([A-Za-z]{5})$/);
  if (m) { GP.settings.mode = 'tour'; GP.refreshMenu(); $('#tourCodeIn').value = m[1].toUpperCase(); status('Add your name and a drink, then tap Join.'); refreshResume(); }

  window.__tour = { get T() { return T; }, get isOrg() { return isOrg; }, get myPid() { return myPid; }, closeElim, startElim, findMatch, setWinner };
})();
