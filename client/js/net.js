// Thin WebSocket client with auto-reconnect-free simple semantics.
export class Net {
  // path: '' for the game server, '/steam-relay' in the desktop app when playing in a friend's store
  constructor(path = '') { this.ws = null; this.handlers = {}; this.open = false; this.queue = []; this.path = path; }
  connect() {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      this.ws = new WebSocket(`${proto}://${location.host}${this.path}`);
      this.ws.onopen = () => { this.open = true; for (const m of this.queue) this.ws.send(m); this.queue = []; resolve(); };
      this.ws.onerror = (e) => { if (!this.open) reject(e); };
      this.ws.onclose = () => { this.open = false; this.emit('close', {}); };
      this.ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch { return; } this.emit(m.t, m); };
    });
  }
  on(t, fn) { (this.handlers[t] ||= []).push(fn); }
  emit(t, m) { for (const fn of this.handlers[t] || []) fn(m); }
  send(obj) {
    const s = JSON.stringify(obj);
    if (this.open) this.ws.send(s); else this.queue.push(s);
  }
  act(a, data = {}) { this.send({ t: 'a', a, ...data }); }
}
