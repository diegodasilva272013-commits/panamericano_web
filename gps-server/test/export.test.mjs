// Exportación: el .xlsx es un ZIP válido con sus XML, el PDF tiene tabla de referencias correcta, y el CSV abre bien en Excel.
import test from "node:test";
import assert from "node:assert/strict";
import { toXlsx, toPdf, toCsvText, crc32, zip } from "../../src/erp/flota/export.js";
import { simplifyLine, matchFence, summarize, speedRuns, downsampleMax } from "../../src/erp/flota/track.js";

const columns = [{ h: "Coche" }, { h: "Distancia (km)", num: true }, { h: "Detalle" }];
const rows = Array.from({ length: 120 }, (_, i) => [`INT ${100 + i}`, 10.5 + i, i % 5 === 0 ? 'ñandú & "comillas" <tag> → límite' : ""]);
const text = (u8) => Buffer.from(u8).toString("latin1");

// lee el ZIP desde su directorio central y verifica cada CRC
function unzip(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let e = buf.length - 22;
  while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  assert.ok(e >= 0, "fin del directorio central");
  const n = dv.getUint16(e + 10, true);
  let p = dv.getUint32(e + 16, true);
  const out = {};
  for (let i = 0; i < n; i++) {
    assert.equal(dv.getUint32(p, true), 0x02014b50);
    const crc = dv.getUint32(p + 16, true), size = dv.getUint32(p + 24, true), nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    const name = Buffer.from(buf.subarray(p + 46, p + 46 + nl)).toString("utf8");
    assert.equal(dv.getUint32(off, true), 0x04034b50);
    const start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true), data = buf.subarray(start, start + size);
    assert.equal(crc32(data), crc, `CRC de ${name}`);
    out[name] = Buffer.from(data).toString("utf8");
    p += 46 + nl + el + cl;
  }
  return out;
}

test("CRC32 correcto (valor de referencia)", () => { assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926); });

test("xlsx: ZIP íntegro, hoja con encabezado fijo, filtro, números como números y texto escapado", () => {
  const f = unzip(toXlsx({ title: "Prueba", sheet: "Mi hoja: ¿?", columns, rows }));
  for (const n of ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/worksheets/sheet1.xml"]) assert.ok(f[n], n);
  const sh = f["xl/worksheets/sheet1.xml"];
  assert.match(sh, /<pane ySplit="1"/);
  assert.match(sh, /<autoFilter ref="A1:C121"\/>/);
  assert.match(sh, /<c r="B2" s="3"><v>10.5<\/v><\/c>/, "decimal como número con formato");
  assert.match(sh, /ñandú &amp; &quot;comillas&quot; &lt;tag&gt; → límite/, "texto escapado");
  assert.doesNotMatch(sh, /<tag>/);
  assert.match(f["xl/workbook.xml"], /sheet name="Mi hoja[^:?\/*[\]"]*"/, "los caracteres prohibidos en el nombre de la hoja se limpian");
  for (const x of Object.values(f)) assert.match(x, /^<\?xml/);
});

test("xlsx sin filas: solo el encabezado, sin filtro roto", () => {
  const f = unzip(toXlsx({ columns, rows: [] }));
  assert.doesNotMatch(f["xl/worksheets/sheet1.xml"], /autoFilter/);
  assert.match(f["xl/worksheets/sheet1.xml"], /<row r="1"/);
});

test("pdf: cabecera, referencias xref apuntan a cada objeto, páginas contadas y fin de archivo", () => {
  const pdf = toPdf({ title: "Reporte de prueba", subtitle: "Del 1 al 30", columns, rows }), t = text(pdf);
  assert.ok(t.startsWith("%PDF-1.4"));
  assert.ok(t.trimEnd().endsWith("%%EOF"));
  const sx = Number(/startxref\n(\d+)/.exec(t)[1]);
  assert.equal(t.slice(sx, sx + 4), "xref");
  const count = Number(/\/Count (\d+)/.exec(t)[1]);
  assert.ok(count >= 3 && count <= 6, `páginas: ${count}`);
  const entries = [...t.slice(sx).matchAll(/(\d{10}) 00000 n /g)].map((m) => Number(m[1]));
  entries.forEach((off, i) => assert.equal(t.slice(off, off + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`, `objeto ${i + 1}`));
  // el largo declarado de cada contenido coincide con lo escrito
  for (const m of t.matchAll(/<< \/Length (\d+) >>\nstream\n/g)) {
    const end = m.index + m[0].length + Number(m[1]);
    assert.equal(t.slice(end, end + 10), "\nendstream");
  }
  assert.match(t, /\(Reporte de prueba\)/);
  assert.match(t, new RegExp(`Pagina ${count} de ${count}`));
});

test("pdf: acentos, paréntesis y barras no rompen el contenido; sin filas muestra un aviso", () => {
  const t = text(toPdf({ title: "Año (2026) \\ prueba", columns, rows: [["Ñandú (x)", 1, "a\\b)(c"]] }));
  assert.match(t, /\(A\xf1o \\\(2026\\\) \\\\ prueba\)/);
  assert.match(t, /\(\xd1and\xfa \\\(x\\\)\)/);
  assert.match(text(toPdf({ title: "Vacío", columns, rows: [] })), /No hay datos para mostrar/);
});

test("csv: con BOM para Excel, separador ';' y comillas escapadas", () => {
  const c = toCsvText({ columns: [{ h: "A" }, { h: "B;" }], rows: [["x;y", 'di"ce'], [1, null]] });
  assert.ok(c.startsWith("﻿"));
  assert.equal(c.split("\r\n")[0].slice(1), 'A;"B;"');
  assert.equal(c.split("\r\n")[1], '"x;y";"di""ce"');
  assert.equal(c.split("\r\n")[2], "1;");
});

test("zip(): archivos vacíos y nombres con acentos", () => {
  const f = unzip(zip([{ name: "vacío.txt", data: new Uint8Array(0) }, { name: "a/b.txt", data: new TextEncoder().encode("hola ñ") }]));
  assert.equal(f["vacío.txt"], "");
  assert.equal(f["a/b.txt"], "hola ñ");
});

// ---------------------------------------------------------------------------------------------- track.js
test("simplifyLine: una recta de 1000 puntos queda en 2; una curva conserva su forma", () => {
  const straight = Array.from({ length: 1000 }, (_, i) => [-24 + i * 1e-4, -65]);
  assert.equal(simplifyLine(straight, 5).length, 2);
  const elbow = [...Array.from({ length: 50 }, (_, i) => [-24 + i * 1e-3, -65]), ...Array.from({ length: 50 }, (_, i) => [-23.951, -65 + i * 1e-3])];
  const s = simplifyLine(elbow, 5);
  assert.ok(s.length >= 3 && s.length <= 5);
  assert.deepEqual(s[0], elbow[0]);
  assert.deepEqual(s.at(-1), elbow.at(-1));
});

test("matchFence: empareja el nombre de la parada del panel con la geocerca", () => {
  const fs = [{ id: 1, name: "Terminal Purmamarca", kind: "terminal" }, { id: 2, name: "Terminal Jujuy", kind: "terminal" }, { id: 3, name: "Rotonda Suri", kind: "zona" }, { id: 4, name: "Humahuaca", kind: "parada" }];
  assert.equal(matchFence("Purmamarca", fs).id, 1);
  assert.equal(matchFence("San Salvador de Jujuy", fs).id, 2);
  assert.equal(matchFence("Humahuaca", fs).id, 4);
  assert.equal(matchFence("Tilcara", fs), null);
  assert.equal(matchFence("", fs), null);
});

test("summarize: distancia, velocidades, tiempos y detenciones de un recorrido", () => {
  const t0 = Date.parse("2026-04-06T12:00:00Z");
  const mk = (i, speed, lat) => ({ event_time: new Date(t0 + i * 10_000).toISOString(), lat, lng: -65, speed, ignition: true });
  // 30 reportes moviéndose a ~72 km/h (200 m cada 10 s), después 20 detenido 200 s, después 10 más moviéndose a 100 km/h
  const ps = [];
  let lat = -24;
  for (let i = 0; i < 30; i++) { ps.push(mk(i, 72, lat)); lat += 200 / 111195; }
  for (let i = 30; i < 50; i++) ps.push(mk(i, 0, lat));
  for (let i = 50; i < 60; i++) { ps.push(mk(i, 100, lat)); lat += 280 / 111195; }
  const s = summarize(ps, { limit: 90 });
  assert.ok(Math.abs(s.distanceM - (29 * 200 + 10 * 280)) < 400, `distancia ${Math.round(s.distanceM)}`);
  assert.equal(s.maxSpeed, 100);
  assert.equal(s.stops.length, 1);
  assert.ok(Math.abs(s.stops[0].seconds - 200) <= 10);
  assert.ok(s.movingS > 350 && s.idleS >= 190);
  assert.ok(s.overLimitS >= 80 && s.overLimitS <= 100);
  assert.equal(summarize([]).count, 0);
  assert.equal(speedRuns(ps, 90).map((r) => r.cls).join(","), "ok,stop,over");
  assert.equal(downsampleMax(Array.from({ length: 1000 }, (_, i) => (i === 500 ? 99 : 1)), 100).some((p) => p.v === 99), true, "el pico no se pierde al reducir");
});
