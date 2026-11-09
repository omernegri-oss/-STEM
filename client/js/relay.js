// Fallback route for online play when two home networks can't connect directly (strict routers, carrier-grade
// NAT): messages go through free public MQTT brokers over a secure WebSocket instead. A tiny MQTT 3.1.1 client:
// connect, subscribe, publish (QoS 0), keep-alive. Game messages are strings; large ones are already split into
// pieces by online.js.

// public brokers, tried in order (the host listens on all of them). Tests point at a local broker: window.ST_RELAYS
export const RELAYS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt', 'wss://test.mosquitto.org:8081/mqtt'];
export const relayUrls = () => window.ST_RELAYS || RELAYS;
export const TOPIC = 'stem-supermarket-v1'; // topics: TOPIC/<code>/h (to the host), TOPIC/<code>/c/<friend id> (to a friend)

const enc = new TextEncoder(), dec = new TextDecoder();
const utf = (s) => { const b = enc.encode(s); const out = new Uint8Array(b.length + 2); out[0] = b.length >> 8; out[1] = b.length & 255; out.set(b, 2); return out; };
const cat = (...parts) => { const n = parts.reduce((a, p) => a + p.length, 0), out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
function packet(type, body) {
  const hdr = [type]; let x = body.length;
  do { let d = x % 128; x = Math.floor(x / 128); if (x > 0) d |= 128; hdr.push(d); } while (x > 0);
  return cat(new Uint8Array(hdr), body);
}

export class Mqtt {
  constructor(url) { this.url = url; this.open = false; this.buf = new Uint8Array(0); this.pid = 0; this.onmessage = null; this.onclose = null; }
  connect(clientId, timeout = 7000) {
    return new Promise((resolve, reject) => {
      let done = false;
      const fail = (e) => { if (done) return; done = true; clearTimeout(t); try { this.ws.close(); } catch {} reject(e); };
      const t = setTimeout(() => fail(new Error('timeout')), timeout);
      let ws;
      try { ws = this.ws = new WebSocket(this.url, 'mqtt'); } catch (e) { fail(e); return; }
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => ws.send(packet(0x10, cat(utf('MQTT'), new Uint8Array([4, 0x02, 0, 60]), utf(clientId))));
      ws.onmessage = (e) => this.feed(new Uint8Array(e.data));
      ws.onerror = () => fail(new Error('error'));
      ws.onclose = () => { const was = this.open; this.open = false; clearInterval(this.ping); fail(new Error('closed')); if (was && this.onclose) this.onclose(); };
      this.onconnack = (rc) => {
        if (done) return;
        if (rc !== 0) { fail(new Error('refused ' + rc)); return; }
        done = true; clearTimeout(t); this.open = true;
        this.ping = setInterval(() => this.raw(0xC0, new Uint8Array(0)), 25000);
        resolve(this);
      };
    });
  }
  // the broker's stream can carry several packets per frame (or one packet over several frames)
  feed(chunk) {
    this.buf = this.buf.length ? cat(this.buf, chunk) : chunk;
    for (;;) {
      const b = this.buf; if (b.length < 2) return;
      let len = 0, mul = 1, i = 1, d;
      do { if (i >= b.length) return; d = b[i++]; len += (d & 127) * mul; mul *= 128; } while (d & 128);
      if (b.length < i + len) return;
      this.handle(b[0], b.subarray(i, i + len));
      this.buf = b.subarray(i + len);
    }
  }
  handle(type, body) {
    const kind = type >> 4;
    if (kind === 2) this.onconnack && this.onconnack(body[1]);
    else if (kind === 3) {
      const tl = (body[0] << 8) | body[1], topic = dec.decode(body.subarray(2, 2 + tl));
      const off = 2 + tl + (((type >> 1) & 3) ? 2 : 0);
      if (this.onmessage) this.onmessage(topic, dec.decode(body.subarray(off)));
    }
  }
  subscribe(topic) { this.pid = this.pid % 65535 + 1; this.raw(0x82, cat(new Uint8Array([this.pid >> 8, this.pid & 255]), utf(topic), new Uint8Array([0]))); }
  publish(topic, text) { this.raw(0x30, cat(utf(topic), enc.encode(text))); }
  raw(type, body) { if (this.ws && this.ws.readyState === 1) this.ws.send(packet(type, body)); }
  close() { clearInterval(this.ping); this.open = false; try { this.raw(0xE0, new Uint8Array(0)); this.ws.close(); } catch {} }
}

// a two-way link over a broker that looks like a PeerJS data connection: on('data' | 'close' | 'error'), send, close
export function relayLink(mqtt, sendTopic, prefix = '') {
  const handlers = {};
  const link = {
    open: true, via: 'relay',
    on(ev, fn) { (handlers[ev] ||= []).push(fn); },
    fire(ev, x) { for (const fn of handlers[ev] || []) fn(x); },
    send(s) { if (link.open) mqtt.publish(sendTopic, prefix + s); },
    close() { if (!link.open) return; mqtt.publish(sendTopic, prefix + BYE); link.open = false; link.fire('close'); },
  };
  return link;
}
export const BYE = '\u0002bye';
