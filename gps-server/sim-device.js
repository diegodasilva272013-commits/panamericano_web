// Simula un equipo Rinho: manda posiciones por UDP o TCP con el formato real, espera el ACK del servidor y reintenta si no llega
// (7 s, hasta 4 reintentos, ventana de 9 mensajes), manda keep-alive y vuelca su memoria al recuperar la conexión.
import dgram from "node:dgram";
import net from "node:net";
import { encodePosition, keepAlive, extractFrames, parseFrame } from "./taip.js";

export class SimDevice {
  constructor({ deviceId, host = "127.0.0.1", port, transport = "udp", ackTimeoutMs = 7000, retries = 4, window = 9, kind = "CQ", dropAcks = 0 }) {
    Object.assign(this, { deviceId, host, port, transport, ackTimeoutMs, retries, window, kind, dropAcks });
    this.msgNum = 0; this.reportId = 0; this.pending = new Map(); this.waiting = []; this.sock = null; this.sent = 0; this.retransmits = 0; this.acked = 0; this.lost = 0; this.log = [];
  }

  async connect() {
    if (this.transport === "tcp") {
      this.sock = new net.Socket();
      let buf = "";
      this.sock.on("data", (d) => { buf += d.toString("latin1"); const { frames, rest } = extractFrames(buf); buf = rest; frames.forEach((f) => this.onFrame(f)); });
      this.sock.on("error", () => {});
      await new Promise((res, rej) => { this.sock.once("error", rej); this.sock.connect(this.port, this.host, res); });
    } else {
      this.sock = dgram.createSocket("udp4");
      this.sock.on("message", (m) => extractFrames(m.toString("latin1")).frames.forEach((f) => this.onFrame(f)));
      this.sock.on("error", () => {});
      await new Promise((res) => this.sock.bind(0, res));
    }
    return this;
  }

  raw(text) {
    if (this.transport === "tcp") { if (this.sock?.writable) this.sock.write(Buffer.from(text, "latin1")); }
    else this.sock?.send(Buffer.from(text, "latin1"), this.port, this.host);
  }

  onFrame(f) {
    const r = parseFrame(f, { strictChecksum: false });
    if (!r.ok || r.type !== "unknown" || r.body !== "ACK") return;
    if (this.dropAcks > 0) { this.dropAcks--; return; } // simula un ACK que se perdió en el camino
    const p = this.pending.get(r.msgNum);
    if (!p) return;
    clearTimeout(p.timer); this.pending.delete(r.msgNum); this.acked++; p.resolve({ acked: true, attempts: p.tries });
    this.pump();
  }

  /** Manda una posición y devuelve { acked, attempts } cuando se confirma o se da por perdida. */
  send(pos, extra = {}) { return this.enqueue(pos, extra); }
  enqueue(pos, extra) {
    return new Promise((resolve) => { this.waiting.push({ pos, extra, resolve }); this.pump(); });
  }

  pump() {
    while (this.pending.size < this.window && this.waiting.length) {
      const w = this.waiting.shift();
      const num = this.msgNum; this.msgNum = (this.msgNum + 1) & 0x7fff;
      const text = encodePosition(w.pos, { kind: this.kind, msgNum: num, deviceId: this.deviceId, reportId: this.reportId++ & 0xff, extra: w.extra });
      const p = { text, tries: 0, resolve: w.resolve, timer: null };
      this.pending.set(num, p); this.sent++;
      const attempt = () => {
        p.tries++; this.raw(text);
        p.timer = setTimeout(() => {
          if (p.tries > this.retries) { this.pending.delete(num); this.lost++; p.resolve({ acked: false, attempts: p.tries }); this.pump(); return; }
          this.retransmits++; attempt();
        }, this.ackTimeoutMs);
      };
      attempt();
    }
  }

  keepAlive() { this.raw(keepAlive(this.deviceId)); }

  /** Manda una lista de posiciones y espera a que todas se resuelvan. */
  async sendAll(positions, extra = {}) { return Promise.all(positions.map((p) => this.enqueue(p, extra))); }

  async close() {
    for (const p of this.pending.values()) clearTimeout(p.timer);
    this.pending.clear(); this.waiting = [];
    if (this.transport === "tcp") this.sock?.destroy(); else await new Promise((r) => { try { this.sock.close(r); } catch { r(); } });
  }
}
