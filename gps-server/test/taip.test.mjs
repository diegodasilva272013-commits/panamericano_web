// Pruebas del protocolo Rinho: checksum, tramas, ACK, todos los tipos de reporte y comparación con el parser del fabricante.
import test from "node:test";
import assert from "node:assert/strict";
import { checksum, frame, ack, command, extractFrames, parseFrame, parseAll, encodePosition, keepAlive } from "../taip.js";

const ID = "860012345678901";
const P = { t: Date.UTC(2026, 3, 6, 15, 30, 25), lat: -23.7619, lng: -65.4999, speed: 78, course: 357, ign: true, voltage: 12.8, odometerM: 123456, sats: 11, csq: 19 };

test("checksum: XOR desde '>' hasta '*' (verificado contra un cálculo independiente en Python)", () => {
  assert.equal(checksum(">ACK;#002A;ID=860012345678901;*"), "38");
  assert.equal(checksum(">KA;ID=860012345678901;*"), "10");
  assert.equal(checksum(">QVR;#0042;ID=860012345678901;*"), "51");
  assert.equal(ack(0x2a, ID), ">ACK;#002A;ID=860012345678901;*38<");
  // el algoritmo es el del servidor de ejemplo del fabricante (network.js: ">ACK;#MSG;ID=...;*" + XOR de todo lo anterior)
  assert.equal(command("QVR", 0x42, ID), ">QVR;#0042;ID=860012345678901;*51<");
});

test("el ACK repite exactamente el número de mensaje y el equipo, y es una trama válida", () => {
  for (const n of [0, 1, 0x2a, 0x7fff]) {
    const a = parseFrame(ack(n, ID));
    assert.equal(a.ok, true); assert.equal(a.checksumOk, true); assert.equal(a.msgNum, n); assert.equal(a.deviceId, ID);
  }
});

test("posición de la guía (ejemplo RCQ): los campos principales coinciden con lo que la guía documenta", () => {
  const raw = ">RCQ28060426153025-3462000-05838000045180A203128000000110000050A100512;#002A;ID=860012345678901;*5E<";
  const r = parseFrame(raw, { strictChecksum: false });
  assert.equal(r.ok, true);
  assert.equal(r.eventTime, "2026-04-06T15:30:25.000Z");
  assert.equal(r.lat, -34.62); assert.equal(r.lng, -58.38);
  assert.equal(r.speed, 45); assert.equal(r.course, 180); assert.equal(r.ignition, true);
  assert.equal(r.voltage, 12.8); assert.equal(r.odometerM, 17);
  assert.equal(r.msgNum, 0x2a); assert.equal(r.needsAck, true);
  assert.equal(r.checksumOk, false, "el checksum de ese ejemplo de la guía no corresponde al algoritmo de la guía: se avisa, no se asume");
  assert.equal(parseFrame(raw).ok, false, "en modo estricto se rechaza");
});

test("armar y volver a leer una posición mantiene todos los datos (todos los tipos de reporte)", () => {
  const T0 = { c: 23.5, ageS: 10 }, T1 = { c: -25.3, ageS: 11 };
  const cases = [
    ["CQ", {}], ["CP", {}], ["CR", { temp0: T0 }], ["CV", { temp0: T0, temp1: T1 }], ["BQ", { backupV: 4.16 }],
    ["BR", { backupV: 4.16, temp0: T0 }], ["BV", { backupV: 4.16, temp0: T0, temp1: T1 }], ["HQ", { backupV: 4.16, engineS: 225000 }],
    ["HR", { backupV: 4.16, engineS: 225000, temp0: T0 }], ["HV", { backupV: 4.16, engineS: 225000, temp0: T0, temp1: T1 }],
    ["CT", { ibutton: "01ABCDEF12345678" }], ["CU", { session: true, sessionCode: "DRIVER01" }], ["EQ", { can: { 2010: "1000.00", 5000: "0.00" } }],
  ];
  for (const [kind, extra] of cases) {
    const r = parseFrame(encodePosition(P, { kind, msgNum: 0x2c, deviceId: ID, reportId: 0x28, extra }));
    assert.equal(r.ok, true, kind); assert.equal(r.checksumOk, true, kind + " checksum");
    assert.equal(r.type, "position"); assert.equal(r.reportType, kind);
    assert.equal(r.eventTime, "2026-04-06T15:30:25.000Z", kind);
    assert.equal(r.lat, -23.7619); assert.equal(r.lng, -65.4999); assert.equal(r.speed, 78); assert.equal(r.course, 357);
    assert.equal(r.ignition, true); assert.equal(r.voltage, 12.8); assert.equal(r.odometerM, 123456); assert.equal(r.sats, 11); assert.equal(r.csq, 19);
    assert.equal(r.msgNum, 0x2c); assert.equal(r.deviceId, ID); assert.equal(r.needsAck, true);
    if (extra.backupV) assert.equal(r.backupV, 4.16, kind);
    if (extra.engineS) assert.equal(r.engineS, 225000, kind);
    if (extra.temp0) assert.deepEqual(r.temp0, T0, kind);
    if (extra.temp1) assert.deepEqual(r.temp1, T1, kind);
    if (extra.ibutton) assert.equal(r.ibutton, extra.ibutton);
    if (extra.session) { assert.equal(r.session, true); assert.equal(r.sessionCode, "DRIVER01"); }
    if (extra.can) assert.deepEqual(r.can, { protocol: "OBD-II", data: { 2010: "1000.00", 5000: "0.00" } });
  }
});

test("hemisferios: latitud y longitud con los dos signos, y la ignición apagada", () => {
  const r = parseFrame(encodePosition({ ...P, lat: 12.34567, lng: 123.45678, ign: false }, { msgNum: 1, deviceId: ID }));
  assert.equal(r.lat, 12.34567); assert.equal(r.lng, 123.45678); assert.equal(r.ignition, false);
});

test("parámetros extra AP=/PA= y texto TXT=", () => {
  const r = parseFrame(encodePosition(P, { kind: "BQ", msgNum: 5, deviceId: ID, extra: { params: { fuel: 0, temp: 28.9, status: "ok" }, text: "HOLA" } }));
  assert.deepEqual(r.params, { fuel: 0, temp: 28.9, status: "ok" }); assert.equal(r.text, "HOLA");
  const base = encodePosition(P, { kind: "HQ", msgNum: null, deviceId: ID, extra: { engineS: 1 } }).replace(/;ID=.*$/, "");
  const legacy = parseFrame(frame(base.slice(1) + ";PA=id:0000059278,c0:1496,c4:,c6:84", 0x2a, ID));
  assert.equal(legacy.ok, true); assert.equal(legacy.params.c0, 1496); assert.equal(legacy.params.c4, null); assert.equal(legacy.params.c6, 84);
});

test("quién recibe ACK: reportes con número sí; keep-alive, respuestas (>= 0x8000) y mensajes sin número no", () => {
  assert.equal(parseFrame(encodePosition(P, { msgNum: 0x10, deviceId: ID })).needsAck, true);
  assert.equal(parseFrame(encodePosition(P, { msgNum: null, deviceId: ID })).needsAck, false);
  const ka = parseFrame(keepAlive(ID)); assert.equal(ka.type, "keepalive"); assert.equal(ka.needsAck, false);
  const resp = parseFrame(frame("RVR RINHO IOT v1.09.20 ZE EG915U LC86G 4MB", 0x8042, ID));
  assert.equal(resp.type, "version"); assert.equal(resp.isResponse, true); assert.equal(resp.needsAck, false);
  assert.equal(resp.version, "RINHO IOT v1.09.20 ZE EG915U LC86G 4MB");
  const conf = parseFrame(frame("OK", 0x8001, ID)); assert.equal(conf.type, "confirmation"); assert.equal(conf.needsAck, false);
  assert.equal(parseFrame(frame("RIMEI" + ID, 0x8022, ID)).field, "imei");
  assert.equal(parseFrame(frame("RTAGFLEET_01", 0x8023, ID)).value, "FLEET_01");
});

test("varias tramas en un mismo datagrama y tramas partidas en TCP", () => {
  const a = encodePosition(P, { msgNum: 1, deviceId: ID }), b = encodePosition({ ...P, speed: 10 }, { msgNum: 2, deviceId: ID }), ka = keepAlive(ID);
  const all = parseAll(a + b + ka);
  assert.deepEqual(all.map((x) => x.type), ["position", "position", "keepalive"]);
  assert.deepEqual(all.filter((x) => x.msgNum != null).map((x) => x.msgNum), [1, 2]);
  // TCP: llega en pedazos arbitrarios
  let buf = "";
  const got = [];
  const stream = a + ka + b;
  for (let i = 0; i < stream.length; i += 13) { buf += stream.slice(i, i + 13); const { frames, rest } = extractFrames(buf); got.push(...frames); buf = rest; }
  assert.equal(got.length, 3); assert.equal(buf, "");
  assert.equal(got.join(""), stream);
});

test("basura y tramas dañadas se rechazan con un motivo y no tiran el servidor", () => {
  const good = encodePosition(P, { msgNum: 1, deviceId: ID });
  assert.equal(parseFrame("hola").reason, "formato");
  assert.equal(parseFrame(">RCQ123<").reason, "sin_checksum");
  const flipped = good.replace("-2376190", "-2376191"); // un dígito cambiado en el camino
  assert.notEqual(flipped, good);
  assert.equal(parseFrame(flipped).reason, "checksum");
  assert.equal(parseFrame(flipped, { strictChecksum: false }).checksumOk, false);
  assert.equal(parseFrame(frame("RCQ28060426", 1, ID)).reason, "corto");
  assert.equal(parseFrame(frame("RCQ28" + "991399".padEnd(62, "0"), 1, ID)).ok, false, "fecha imposible");
  assert.equal(parseFrame(">RCQ;ID=;*00<").ok, false);
  assert.equal(parseFrame(frame("XYZ123", 7, ID)).type, "unknown");
  for (let i = 0; i < 300; i++) { // ruido aleatorio: nunca lanza excepciones
    const junk = ">" + Array.from({ length: 20 + (i % 60) }, () => String.fromCharCode(32 + Math.floor(Math.random() * 90))).join("") + "<";
    assert.doesNotThrow(() => parseFrame(junk));
  }
});

test("contraste con el parser del fabricante (expresión regular de rinho-udp-server/protocol.js, parserCQ)", () => {
  // misma expresión que usa el servidor de ejemplo de Rinho para leer reportes CQ
  const reb = />RCQ([\w]{2})([\d]{2})([\d]{2})([\d]{2})([\d]{2})([\d]{2})([\d]{2})([+-]{1}[\d]{7})([+-]{1}[\d]{8})([\d]{3})([\d]{3})([\w]{2})([\w]{2})([\d]{3})([\w]{8})([\w]{1})([\w]{1})([\d]{2})([\d]{2})([\w]{4})([\d]{1})([\w]{1})([\w]{2})(;TXT=([\w\s]*)|)(;#([\w]{4})|)?;ID=([\w]*)(;|)/gm;
  for (const p of [P, { ...P, lat: -22.1, lng: -65.6, speed: 0, course: 0, ign: false, odometerM: 0 }, { ...P, lat: -24.18, lng: -65.3, speed: 120, course: 180, odometerM: 99999999 }]) {
    const raw = encodePosition(p, { msgNum: 0x2a, deviceId: ID, reportId: 0x28 });
    reb.lastIndex = 0;
    const x = reb.exec(raw);
    assert.ok(x, "el parser del fabricante reconoce la trama que armamos");
    const mine = parseFrame(raw);
    assert.equal(x[8] / 100000, mine.lat); assert.equal(x[9] / 100000, mine.lng);
    assert.equal(parseInt(x[10]), mine.speed); assert.equal(parseInt(x[11]), mine.course);
    assert.equal(!!(parseInt(x[12], 16) & 0x80), mine.ignition);
    assert.equal(x[14] / 10, mine.voltage); assert.equal(parseInt(x[15], 16), mine.odometerM);
    assert.equal(x[27], "002A"); assert.equal(x[28], ID);
  }
});
