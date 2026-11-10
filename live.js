'use strict';
/* Live play transport: two players meet in a room (4-letter code) on a public MQTT broker over WebSocket.
   Turn-based, so latency barely matters; the thrower is authoritative and sends the verdict. */
(() => {
  const cfg = window.GENPONG_CONFIG || {};
  const override = new URLSearchParams(location.search).get('broker'); // e.g. ?broker=ws://localhost:8883 for testing
  const brokers = override ? [override] : cfg.brokers || [];
  const id = Math.random().toString(36).slice(2, 10);
  let client = null, topic = '', seq = 0, onMsg = null, onState = null, seen = new Set();
  let lastHeard = 0, peerSeen = false, timers = [], open = false;

  function loadLib() {
    if (window.mqtt) return Promise.resolve();
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'vendor/mqtt.min.js'; s.onload = () => (window.mqtt ? res() : rej(new Error('mqtt missing'))); s.onerror = () => rej(new Error('mqtt load failed'));
      document.head.appendChild(s);
    });
  }
  function connectOne(url) {
    return new Promise((res, rej) => {
      let done = false;
      const c = window.mqtt.connect(url, { clientId: 'gp_' + id + Math.random().toString(16).slice(2, 6), clean: true, connectTimeout: 6000, reconnectPeriod: 0, keepalive: 20 });
      const fail = (e) => { if (!done) { done = true; try { c.end(true); } catch (_) { /* ignore */ } rej(e || new Error('connect failed')); } };
      c.once('connect', () => { if (!done) { done = true; res(c); } });
      c.once('error', fail);
      setTimeout(() => fail(new Error('timeout')), 7000);
    });
  }
  function clearTimers() { timers.forEach(clearInterval); timers = []; }

  async function openRoom(code, messageHandler, stateHandler) {
    await closeRoom(false);
    onMsg = messageHandler; onState = stateHandler; topic = 'genpong-fan/v1/' + code; seen = new Set(); peerSeen = false; seq = 0;
    await loadLib();
    let lastErr = null, c = null;
    for (const url of brokers) { try { c = await connectOne(url); break; } catch (e) { lastErr = e; } }
    if (!c) throw lastErr || new Error('no broker');
    client = c; open = true; lastHeard = Date.now();
    client.options.reconnectPeriod = 2000;
    const sub = () => client.subscribe(topic, { qos: 1 });
    client.on('connect', sub);
    client.on('message', (t, payload) => {
      let m; try { m = JSON.parse(payload.toString()); } catch (_) { return; }
      if (!m || m.f === id) return;
      const key = m.f + ':' + m.n;
      if (seen.has(key)) return; seen.add(key); if (seen.size > 500) seen = new Set([...seen].slice(-200));
      peerSeen = true; lastHeard = Date.now();
      if (m.t !== 'ping' && onMsg) onMsg(m);
    });
    sub();
    timers.push(setInterval(() => send({ t: 'ping' }), 3000));
    timers.push(setInterval(() => { if (peerSeen && Date.now() - lastHeard > 15000 && onState) { peerSeen = false; onState('lost'); } }, 2000));
  }
  function send(msg) {
    if (!client || !open) return;
    client.publish(topic, JSON.stringify({ ...msg, f: id, n: ++seq }), { qos: 1 });
  }
  function closeRoom(sayBye) {
    clearTimers();
    const c = client; client = null; open = false; peerSeen = false;
    if (!c) return Promise.resolve();
    return new Promise((res) => {
      const finish = () => { try { c.end(true); } catch (_) { /* ignore */ } res(); };
      if (sayBye) { try { c.publish(topic, JSON.stringify({ t: 'bye', f: id, n: ++seq }), { qos: 1 }, finish); setTimeout(finish, 600); } catch (_) { finish(); } }
      else finish();
    });
  }
  window.GenpongLive = { open: openRoom, send, close: closeRoom, id: () => id };
})();
