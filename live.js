'use strict';
/* Live transport: rooms ("channels") on a public MQTT broker over WebSocket. One connection, many channels,
   so a player can sit in a tournament lobby and play a match at the same time. Turn-based, so latency barely matters. */
(() => {
  const cfg = window.GENPONG_CONFIG || {};
  const override = new URLSearchParams(location.search).get('broker'); // e.g. ?broker=ws://localhost:8883 for testing
  const brokers = override ? [override] : cfg.brokers || [];
  const id = Math.random().toString(36).slice(2, 10);
  let client = null, connecting = null;
  const channels = new Map(); // topic -> channel

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
  async function ensureClient() {
    if (client) return client;
    if (connecting) return connecting;
    connecting = (async () => {
      await loadLib();
      let lastErr = null, c = null;
      for (const url of brokers) { try { c = await connectOne(url); break; } catch (e) { lastErr = e; } }
      if (!c) throw lastErr || new Error('no broker');
      c.options.reconnectPeriod = 2000;
      c.on('connect', () => channels.forEach((ch) => c.subscribe(ch.topic, { qos: 1 })));
      c.on('message', (topic, payload) => { const ch = channels.get(topic); if (ch) ch._in(payload); });
      client = c; return c;
    })();
    try { return await connecting; } finally { connecting = null; }
  }

  // join(name, onMsg, onState, {heartbeat}) -> channel {send(msg,{retain}), close(sayBye), id}
  async function join(name, onMsg, onState, opts = {}) {
    const topic = 'genpong-fan/v1/' + name;
    if (channels.has(topic)) await channels.get(topic).close(false);
    const c = await ensureClient();
    let seq = 0, seen = new Set(), lastHeard = Date.now(), peerSeen = false, timers = [], open = true;
    const ch = {
      topic, id,
      _in(payload) {
        if (!open || !payload || !payload.length) return; // empty payload = cleared retained message
        let m; try { m = JSON.parse(payload.toString()); } catch (_) { return; }
        if (!m || m.f === id) return;
        const key = m.f + ':' + m.n;
        if (seen.has(key)) return; seen.add(key); if (seen.size > 800) seen = new Set([...seen].slice(-300));
        peerSeen = true; lastHeard = Date.now();
        if (m.t !== 'ping' && onMsg) onMsg(m);
      },
      send(msg, o = {}) {
        if (!open || !client) return;
        client.publish(topic, JSON.stringify({ ...msg, f: id, n: ++seq }), { qos: 1, retain: !!o.retain });
      },
      clearRetained() { if (client) client.publish(topic, '', { qos: 1, retain: true }); },
      close(sayBye) {
        if (!open) return Promise.resolve();
        open = false; timers.forEach(clearInterval); channels.delete(topic);
        return new Promise((res) => {
          const done = () => { try { client && client.unsubscribe(topic); } catch (_) { /* ignore */ } maybeEnd(); res(); };
          if (sayBye && client) { try { client.publish(topic, JSON.stringify({ t: 'bye', f: id, n: ++seq }), { qos: 1 }, done); setTimeout(done, 600); } catch (_) { done(); } }
          else done();
        });
      },
    };
    channels.set(topic, ch);
    c.subscribe(topic, { qos: 1 });
    if (opts.heartbeat) {
      timers.push(setInterval(() => ch.send({ t: 'ping' }), 3000));
      timers.push(setInterval(() => { if (peerSeen && Date.now() - lastHeard > 15000 && onState) { peerSeen = false; onState('lost'); } }, 2000));
    }
    return ch;
  }
  function maybeEnd() {
    if (channels.size || !client) return;
    const c = client; client = null;
    setTimeout(() => { if (!channels.size) { try { c.end(true); } catch (_) { /* ignore */ } } else client = c; }, 50);
  }
  window.GenpongLive = { join, id: () => id };
})();
