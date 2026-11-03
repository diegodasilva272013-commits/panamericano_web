// Protocolo Rinho (familia TAIP). Implementa la "Guía de Integración del Protocolo Rinho v1.2":
// extracción de tramas >...<, checksum XOR, reportes de posición RCQ/RCP/RCR/RCV/RCT/RCU/RBQ/RBR/RBV/RHQ/RHR/RHV/REQ/RER,
// versión (RVR), keep-alive (KA), inventario (RCXHWI/RSN/RIMEI/RTAG), parámetros AP=/PA= y armado de ACK y comandos.
// Sin dependencias: se usa tanto en el servidor receptor como en las pruebas.

/** Checksum XOR de todos los bytes de `partial` (desde ">" hasta "*" inclusive), en 2 dígitos hex mayúscula. */
export function checksum(partial) {
  let c = 0;
  for (let i = 0; i < partial.length; i++) c ^= partial.charCodeAt(i) & 0xff;
  return c.toString(16).toUpperCase().padStart(2, "0");
}

/** Arma un mensaje completo: >BODY;#MSGNUM;ID=DEVICEID;*CS< (msgNum puede ser null: p. ej. KA). */
export function frame(body, msgNum, deviceId) {
  const num = msgNum == null ? "" : `;#${hex(msgNum, 4)}`;
  const partial = `>${body}${num};ID=${deviceId};*`;
  return partial + checksum(partial) + "<";
}
export const ack = (msgNum, deviceId) => frame("ACK", msgNum, deviceId);
export const command = (body, msgNum, deviceId) => frame(body, msgNum, deviceId);

const hex = (n, w) => Number(n).toString(16).toUpperCase().padStart(w, "0");

/** Extrae TODAS las tramas >...< de un texto (un datagrama puede traer varias). Devuelve { frames, rest }. */
export function extractFrames(text) {
  const frames = [];
  let last = 0;
  const re = />([^<>]*)</g;
  let m;
  while ((m = re.exec(text))) { frames.push(m[0]); last = re.lastIndex; }
  // lo que queda después de la última trama completa (en TCP puede ser el comienzo de la siguiente)
  const tail = text.slice(last);
  const open = tail.lastIndexOf(">");
  return { frames, rest: open >= 0 ? tail.slice(open) : "" };
}

const POSITION = /^R(CQ|CP|CR|CV|CT|CU|BQ|BR|BV|HQ|HR|HV|EQ|ER)/;
// largo del sufijo posicional que cada tipo agrega después de los 66 caracteres base
const SUFFIX = { CQ: 0, CP: 0, CR: 7, CV: 14, CT: 0, CU: 0, BQ: 3, BR: 10, BV: 17, HQ: 11, HR: 18, HV: 25, EQ: 0, ER: 0 };
const BASE = 66;

/** Convierte "+0235" + "0A" en { c: 23.5, ageS: 10 }. */
const temp = (raw, age) => {
  const v = Number(raw);
  return Number.isFinite(v) ? { c: v / 10, ageS: /^[0-9A-Fa-f]{2}$/.test(age) ? parseInt(age, 16) : null } : null;
};

/**
 * Interpreta UNA trama. Devuelve siempre un objeto con `ok`.
 *  ok:false -> { reason, raw }  (checksum, formato, etc.: se descarta y NO se confirma)
 *  ok:true  -> { type: 'position'|'version'|'keepalive'|'inventory'|'confirmation'|'unknown', deviceId, msgNum, isResponse, needsAck, ... }
 */
export function parseFrame(raw, { strictChecksum = true } = {}) {
  const m = /^>([^<>]*)<$/.exec(raw.trim());
  if (!m) return { ok: false, reason: "formato", raw };
  const inner = m[1];
  const cs = /;\*([0-9A-Fa-f]{2})$/.exec(inner);
  if (!cs) return { ok: false, reason: "sin_checksum", raw };
  const withoutCs = inner.slice(0, cs.index + 2); // incluye ";*"
  const expected = checksum(">" + withoutCs);
  const checksumOk = expected === cs[1].toUpperCase();
  if (!checksumOk && strictChecksum) return { ok: false, reason: "checksum", raw, expected, got: cs[1].toUpperCase() };

  const segs = inner.slice(0, cs.index).split(";");
  let body = segs.shift();
  let msgNumHex = "", deviceId = "";
  const extra = [];
  for (const s of segs) {
    if (/^#[0-9A-Fa-f]{4}$/.test(s)) msgNumHex = s.slice(1).toUpperCase();
    else if (s.startsWith("ID=")) deviceId = s.slice(3);
    else extra.push(s);
  }
  if (!/^[A-Za-z0-9-]{1,32}$/.test(deviceId)) return { ok: false, reason: "sin_id", raw };
  const msgNum = msgNumHex ? parseInt(msgNumHex, 16) : null;
  const isResponse = msgNum != null && msgNum >= 0x8000;
  const base = { ok: true, deviceId, msgNum, isResponse, checksumOk, raw };

  if (body === "KA") return { ...base, type: "keepalive", needsAck: false };
  const needsAck = msgNum != null && !isResponse;

  const pm = POSITION.exec(body);
  if (pm) {
    const kind = pm[1], d = body.slice(3);
    if (d.length < BASE + SUFFIX[kind]) return { ok: false, reason: "corto", raw };
    const p = parsePosition(kind, d, extra);
    if (!p.ok) return { ...p, raw };
    return { ...base, ...p, type: "position", needsAck };
  }
  if (body.startsWith("RVR")) return { ...base, type: "version", version: body.slice(3).trim(), needsAck };
  if (body.startsWith("RCXHWI")) return { ...base, type: "inventory", field: "hwi", value: body.slice(6), needsAck };
  if (body.startsWith("RSN")) return { ...base, type: "inventory", field: "sn", value: body.slice(3), needsAck };
  if (body.startsWith("RIMEI")) return { ...base, type: "inventory", field: "imei", value: body.slice(5), needsAck };
  if (body.startsWith("RTAG")) return { ...base, type: "inventory", field: "tag", value: body.slice(4), needsAck };
  if (isResponse) return { ...base, type: "confirmation", body, needsAck: false };
  return { ...base, type: "unknown", body, needsAck: false };
}

function parsePosition(kind, d, extra) {
  const s = (a, b) => d.slice(a, b);
  if (!/^[0-9A-Fa-f]{2}$/.test(s(0, 2))) return { ok: false, reason: "campos" };
  const dd = +s(2, 4), mm = +s(4, 6), yy = +s(6, 8), hh = +s(8, 10), mi = +s(10, 12), ss = +s(12, 14);
  const lat = Number(s(14, 22)) / 1e5, lng = Number(s(22, 31)) / 1e5;
  const speed = Number(s(31, 34)), course = Number(s(34, 37));
  if (![dd, mm, yy, hh, mi, ss, lat, lng, speed, course].every(Number.isFinite)) return { ok: false, reason: "campos" };
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31 || hh > 23 || mi > 59 || ss > 60) return { ok: false, reason: "fecha" };
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return { ok: false, reason: "coordenadas" };
  const eventTime = new Date(Date.UTC(2000 + yy, mm - 1, dd, hh, mi, ss));
  const inputs = parseInt(s(37, 39), 16), outputs = parseInt(s(39, 41), 16);
  const out = {
    ok: true, reportType: kind, reportId: s(0, 2).toUpperCase(),
    eventTime: eventTime.toISOString(), lat, lng, speed, course: course % 360,
    ignition: (inputs & 0x80) !== 0, inputs: s(37, 39).toUpperCase(), outputs: s(39, 41).toUpperCase(),
    voltage: Number(s(41, 44)) / 10,
    odometerM: parseInt(s(44, 52), 16),
    gpsPower: s(52, 53) === "1", gpsMode: Number(s(53, 54)), pdop: Number(s(54, 56)), sats: Number(s(56, 58)),
    gpsAgeS: parseInt(s(58, 62), 16), modemPower: s(62, 63) === "1", gsm: Number(s(63, 64)), csq: Number(s(64, 66)),
  };
  // sufijo posicional por tipo
  const x = d.slice(BASE);
  if (kind === "CR") Object.assign(out, { temp0: temp(x.slice(0, 5), x.slice(5, 7)) });
  else if (kind === "CV") Object.assign(out, { temp0: temp(x.slice(0, 5), x.slice(5, 7)), temp1: temp(x.slice(7, 12), x.slice(12, 14)) });
  else if (kind === "BQ") out.backupV = Number(x.slice(0, 3)) / 100;
  else if (kind === "BR") Object.assign(out, { backupV: Number(x.slice(0, 3)) / 100, temp0: temp(x.slice(3, 8), x.slice(8, 10)) });
  else if (kind === "BV") Object.assign(out, { backupV: Number(x.slice(0, 3)) / 100, temp0: temp(x.slice(3, 8), x.slice(8, 10)), temp1: temp(x.slice(10, 15), x.slice(15, 17)) });
  else if (kind === "HQ") Object.assign(out, { backupV: Number(x.slice(0, 3)) / 100, engineS: parseInt(x.slice(3, 11), 16) });
  else if (kind === "HR") Object.assign(out, { backupV: Number(x.slice(0, 3)) / 100, engineS: parseInt(x.slice(3, 11), 16), temp0: temp(x.slice(11, 16), x.slice(16, 18)) });
  else if (kind === "HV") Object.assign(out, { backupV: Number(x.slice(0, 3)) / 100, engineS: parseInt(x.slice(3, 11), 16), temp0: temp(x.slice(11, 16), x.slice(16, 18)), temp1: temp(x.slice(18, 23), x.slice(23, 25)) });
  else if (kind === "CU") { const mm2 = /^([01])$/.exec(x.slice(0, 1)); if (mm2) out.session = x.slice(0, 1) === "1"; }
  // segmentos separados por ";"
  for (const e of extra) {
    if (kind === "CT" && /^[0-9A-Fa-f]{16}$/.test(e)) out.ibutton = e.toUpperCase();
    else if (kind === "CU" && out.sessionCode == null && !/^(AP|PA|TXT)=/.test(e) && !e.includes("=")) out.sessionCode = e;
    else if (/^(AP|PA)=/.test(e)) out.params = parseParams(e.slice(3));
    else if (/^TXT=/.test(e)) out.text = e.slice(4);
    else if ((kind === "EQ" || kind === "ER") && e.includes("=")) out.can = { protocol: kind === "EQ" ? "OBD-II" : "J1939", data: parseCan(e) };
  }
  return out;
}

// parámetros adicionales: nombre:tipo:valor (tipo 1 entero, 2 decimal, 3 texto) o el formato viejo nombre:valor
function parseParams(text) {
  const out = {};
  for (const item of text.split(",")) {
    const p = item.split(":");
    if (p.length >= 3 && /^[123]$/.test(p[1])) { const v = p.slice(2).join(":"); out[p[0]] = p[1] === "3" ? v : (v === "" ? null : Number(v)); }
    else if (p.length >= 2) { const v = p.slice(1).join(":"); out[p[0]] = v === "" ? null : (Number.isFinite(Number(v)) ? Number(v) : v); }
  }
  return out;
}
function parseCan(text) {
  const out = {};
  for (const item of text.split(",")) { const i = item.indexOf("="); if (i > 0) out[item.slice(0, i)] = item.slice(i + 1); }
  return out;
}

/** Atajo: texto crudo de un datagrama/segmento -> lista de resultados de parseFrame. */
export const parseAll = (text, opts) => extractFrames(text).frames.map((f) => parseFrame(f, opts));

// ---------------------------------------------------------------------------------------------
// Lado equipo: arma una trama de posición como la mandaría un Rinho. Lo usa el simulador de GPS y las pruebas.
// p: { t (ms), lat, lng, speed, course, ign, voltage, odometerM, sats, csq }   kind: CQ, CR, HQ, etc.
const pad = (n, w) => String(Math.round(Math.abs(n))).padStart(w, "0");
const signed = (v, w) => (v < 0 ? "-" : "+") + pad(v, w);
export function encodePosition(p, { kind = "CQ", msgNum = null, deviceId, reportId = 0, extra = {} } = {}) {
  const d = new Date(p.t);
  const u = (n) => String(n).padStart(2, "0");
  const inputs = (p.ign ? 0x80 : 0) | (extra.inputs ?? 0);
  let body = "R" + kind
    + hex(reportId & 0xff, 2) + u(d.getUTCDate()) + u(d.getUTCMonth() + 1) + u(d.getUTCFullYear() % 100) + u(d.getUTCHours()) + u(d.getUTCMinutes()) + u(d.getUTCSeconds())
    + signed(p.lat * 1e5, 7) + signed(p.lng * 1e5, 8)
    + pad(p.speed ?? 0, 3) + pad((((p.course ?? 0) % 360) + 360) % 360, 3)
    + hex(inputs, 2) + hex(extra.outputs ?? 0, 2)
    + pad((p.voltage ?? 12.6) * 10, 3) + hex(p.odometerM ?? 0, 8)
    + "1" + "3" + pad(extra.pdop ?? 8, 2) + pad(p.sats ?? 9, 2) + hex(extra.gpsAge ?? 0, 4) + "1" + "1" + pad(p.csq ?? 15, 2);
  const tmp = (t) => (t == null ? "" : signed(t.c * 10, 4) + hex(t.ageS ?? 0, 2));
  const bk = () => pad((extra.backupV ?? 4.1) * 100, 3);
  if (kind === "CR") body += tmp(extra.temp0);
  else if (kind === "CV") body += tmp(extra.temp0) + tmp(extra.temp1);
  else if (kind === "BQ") body += bk();
  else if (kind === "BR") body += bk() + tmp(extra.temp0);
  else if (kind === "BV") body += bk() + tmp(extra.temp0) + tmp(extra.temp1);
  else if (kind === "HQ") body += bk() + hex(extra.engineS ?? 0, 8);
  else if (kind === "HR") body += bk() + hex(extra.engineS ?? 0, 8) + tmp(extra.temp0);
  else if (kind === "HV") body += bk() + hex(extra.engineS ?? 0, 8) + tmp(extra.temp0) + tmp(extra.temp1);
  else if (kind === "CU") body += (extra.session ? "1" : "0") + ";" + (extra.sessionCode ?? "");
  else if (kind === "CT") body += ";" + (extra.ibutton ?? "0000000000000000");
  else if (kind === "EQ" || kind === "ER") body += ";" + Object.entries(extra.can || {}).map(([k, v]) => `${k}=${v}`).join(",");
  if (extra.params) body += ";AP=" + Object.entries(extra.params).map(([k, v]) => `${k}:${typeof v === "string" ? 3 : Number.isInteger(v) ? 1 : 2}:${v}`).join(",");
  if (extra.text) body += ";TXT=" + extra.text;
  return frame(body, msgNum, deviceId);
}
export const keepAlive = (deviceId) => frame("KA", null, deviceId);
