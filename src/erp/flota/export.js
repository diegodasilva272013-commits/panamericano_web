// Exportación de reportes: Excel (.xlsx), PDF y CSV. Sin dependencias: el .xlsx es un ZIP de XML y el PDF se arma a mano (fuente Helvetica estándar).
// columns: [{ h: "Título", num?: true, w?: ancho relativo }]   rows: [[celda, ...]] (texto o número)

const enc = new TextEncoder();

// ------------------------------------------------------------------ ZIP (sin compresión)
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(bytes) { let c = 0xffffffff; for (let i = 0; i < bytes.length; i++) c = CRC_T[(c ^ bytes[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

export function zip(files) { // files: [{ name, data: Uint8Array }]
  const chunks = [], central = [];
  let offset = 0;
  const u16 = (n) => [n & 255, (n >> 8) & 255], u32 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
  const dosTime = 0, dosDate = ((2024 - 1980) << 9) | (1 << 5) | 1;
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.data);
    const local = new Uint8Array([0x50, 0x4b, 3, 4, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(dosTime), ...u16(dosDate), ...u32(crc), ...u32(f.data.length), ...u32(f.data.length), ...u16(name.length), ...u16(0)]);
    chunks.push(local, name, f.data);
    central.push(new Uint8Array([0x50, 0x4b, 1, 2, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(dosTime), ...u16(dosDate), ...u32(crc), ...u32(f.data.length), ...u32(f.data.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), name);
    offset += local.length + name.length + f.data.length;
  }
  const cdSize = central.reduce((a, c) => a + c.length, 0);
  const end = new Uint8Array([0x50, 0x4b, 5, 6, ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(offset), ...u16(0)]);
  const all = [...chunks, ...central, end], out = new Uint8Array(all.reduce((a, c) => a + c.length, 0));
  let p = 0; for (const c of all) { out.set(c, p); p += c.length; }
  return out;
}

// ------------------------------------------------------------------ XLSX
const xmlEsc = (s) => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
const colName = (i) => { let s = ""; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

export function toXlsx({ title = "Reporte", sheet = "Reporte", columns, rows }) {
  const name = xmlEsc(sheet.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Reporte");
  const widths = columns.map((c, i) => Math.min(60, Math.max(8, c.w || Math.max(String(c.h).length, ...rows.slice(0, 300).map((r) => String(r[i] ?? "").length)) + 2)));
  const cell = (v, r, c, style) => {
    const ref = colName(c) + r;
    if (v == null || v === "") return `<c r="${ref}" s="${style}"/>`;
    if (isNum(v)) return `<c r="${ref}" s="${style}"><v>${v}</v></c>`;
    return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
  };
  const head = `<row r="1" ht="22" customHeight="1">${columns.map((c, i) => cell(c.h, 1, i, 1)).join("")}</row>`;
  const body = rows.map((row, ri) => `<row r="${ri + 2}">${columns.map((c, i) => { const v = row[i]; return cell(v, ri + 2, i, isNum(v) ? (Number.isInteger(v) ? 2 : 3) : 0); }).join("")}</row>`).join("");
  const last = colName(Math.max(0, columns.length - 1)) + (rows.length + 1);
  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="16"/><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols><sheetData>${head}${body}</sheetData>${rows.length ? `<autoFilter ref="A1:${last}"/>` : ""}</worksheet>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.0"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FF171200"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF4B400"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const files = [
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`],
    ["docProps/core.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEsc(title)}</dc:title><dc:creator>Panamericano de Jujuy</dc:creator></cp:coreProperties>`],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ["xl/styles.xml", styles],
    ["xl/worksheets/sheet1.xml", sheetXml],
  ];
  return zip(files.map(([n, t]) => ({ name: n, data: enc.encode(t) })));
}

// ------------------------------------------------------------------ PDF
// Caracteres de Latin-1 (WinAnsi) que la fuente estándar dibuja bien; lo demás se reemplaza.
const SUBS = { "→": "->", "←": "<-", "–": "-", "—": "-", "…": "...", "“": '"', "”": '"', "‘": "'", "’": "'", "•": "-", "′": "'", "✓": "ok", "×": "x" };
const latin = (s) => String(s ?? "").replace(/[→←–—…“”‘’•′✓×]/g, (c) => SUBS[c]).replace(/[^\x20-\x7e¡-ÿ]/g, "?");
const pdfStr = (s) => latin(s).replace(/[\\()]/g, (c) => "\\" + c);
// ancho aproximado de Helvetica en milésimas de em
const charW = (ch) => (/[ijl.,:;'|!I ]/.test(ch) ? 278 : /[mwMW@]/.test(ch) ? 833 : /[A-Z]/.test(ch) ? 680 : /[0-9]/.test(ch) ? 556 : /[ftr()\-/]/.test(ch) ? 333 : 520);
const textW = (s, size) => ([...latin(s)].reduce((a, c) => a + charW(c), 0) * size) / 1000;
function fit(s, maxW, size) { s = latin(s); if (textW(s, size) <= maxW) return s; while (s.length > 1 && textW(s + "...", size) > maxW) s = s.slice(0, -1); return s + "..."; }

export function toPdf({ title = "Reporte", subtitle = "", columns, rows, footer = "Panamericano de Jujuy S.A." }) {
  const W = 842, H = 595, M = 32, size = 8, lead = 15, headH = 20;      // A4 horizontal, en puntos
  const usable = W - 2 * M;
  // anchos de columna: proporcionales al contenido, con mínimo y máximo
  const want = columns.map((c, i) => Math.min(260, Math.max(textW(c.h, size + 0.5) + 14, ...rows.slice(0, 400).map((r) => textW(String(r[i] ?? ""), size) + 12), 36)));
  const total = want.reduce((a, b) => a + b, 0), k = total > usable ? usable / total : 1;
  const cw = want.map((w) => w * k);
  const xs = cw.reduce((a, w, i) => (a.push(i ? a[i - 1] + cw[i - 1] : M), a), []);
  const rowsPerPage = Math.floor((H - 2 * M - 46 - headH - 16) / lead);
  const pages = []; for (let i = 0; i < Math.max(1, rows.length); i += rowsPerPage) pages.push(rows.slice(i, i + rowsPerPage));
  const num = (n) => (Math.round(n * 100) / 100).toString();
  const streams = pages.map((pageRows, pi) => {
    const o = [];
    // franja amarilla de encabezado
    o.push(`0.957 0.706 0 rg ${M} ${H - M - 4} ${usable} 4 re f`);
    o.push(`BT /F2 15 Tf 0.09 0.07 0 rg ${M} ${H - M - 26} Td (${pdfStr(fit(title, usable, 15))}) Tj ET`);
    if (subtitle) o.push(`BT /F1 9 Tf 0.38 0.36 0.33 rg ${M} ${H - M - 40} Td (${pdfStr(fit(subtitle, usable, 9))}) Tj ET`);
    let y = H - M - 46 - headH;
    o.push(`0.09 0.09 0.08 rg ${M} ${y} ${usable} ${headH} re f`);
    columns.forEach((c, i) => { const t = fit(c.h, cw[i] - 10, size + 0.5), x = c.num ? xs[i] + cw[i] - 5 - textW(t, size + 0.5) : xs[i] + 5; o.push(`BT /F2 ${size + 0.5} Tf 0.957 0.706 0 rg ${num(x)} ${num(y + 6.5)} Td (${pdfStr(t)}) Tj ET`); });
    pageRows.forEach((row, ri) => {
      y -= lead;
      if (ri % 2 === 1) o.push(`0.965 0.957 0.93 rg ${M} ${y} ${usable} ${lead} re f`);
      columns.forEach((c, i) => {
        const v = row[i], s = isNum(v) ? (Number.isInteger(v) ? v.toLocaleString("es-AR") : v.toLocaleString("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 2 })) : String(v ?? "");
        const t = fit(s, cw[i] - 10, size), x = c.num || isNum(v) ? xs[i] + cw[i] - 5 - textW(t, size) : xs[i] + 5;
        o.push(`BT /F1 ${size} Tf 0.09 0.09 0.08 rg ${num(x)} ${num(y + 4.5)} Td (${pdfStr(t)}) Tj ET`);
      });
    });
    o.push(`0.8 0.78 0.72 RG 0.5 w ${M} ${y} m ${M + usable} ${y} l S`);
    o.push(`BT /F1 7.5 Tf 0.45 0.43 0.4 rg ${M} ${M - 8} Td (${pdfStr(footer)}  -  ${rows.length} ${rows.length === 1 ? "fila" : "filas"}) Tj ET`);
    const pg = `Pagina ${pi + 1} de ${pages.length}`; o.push(`BT /F1 7.5 Tf 0.45 0.43 0.4 rg ${num(W - M - textW(pg, 7.5))} ${M - 8} Td (${pg}) Tj ET`);
    if (!rows.length) o.push(`BT /F1 10 Tf 0.38 0.36 0.33 rg ${M} ${y - 24} Td (No hay datos para mostrar con estos filtros.) Tj ET`);
    return o.join("\n");
  });
  // objetos: 1 catálogo, 2 páginas, 3 fuente, 4 fuente negrita, luego (página, contenido) por cada página
  const objs = [];
  const kids = pages.map((_, i) => `${5 + i * 2} 0 R`).join(" ");
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`;
  objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objs[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  streams.forEach((s, i) => {
    const content = Uint8Array.from(s, (c) => c.charCodeAt(0) & 255);
    objs[5 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + i * 2} 0 R >>`;
    objs[6 + i * 2] = { stream: content };
  });
  const parts = [], offsets = [];
  let pos = 0;
  const push = (data) => { const b = typeof data === "string" ? Uint8Array.from(data, (c) => c.charCodeAt(0) & 255) : data; parts.push(b); pos += b.length; };
  push("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n");
  for (let i = 1; i < objs.length; i++) {
    offsets[i] = pos;
    if (objs[i].stream) { push(`${i} 0 obj\n<< /Length ${objs[i].stream.length} >>\nstream\n`); push(objs[i].stream); push("\nendstream\nendobj\n"); }
    else push(`${i} 0 obj\n${objs[i]}\nendobj\n`);
  }
  const xref = pos;
  push(`xref\n0 ${objs.length}\n0000000000 65535 f \n` + offsets.slice(1).map((o) => String(o).padStart(10, "0") + " 00000 n \n").join(""));
  push(`trailer\n<< /Size ${objs.length} /Root 1 0 R /Info << /Title (${pdfStr(title)}) /Producer (Panamericano de Jujuy) >> >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(pos); let p = 0; for (const b of parts) { out.set(b, p); p += b.length; }
  return out;
}

// ------------------------------------------------------------------ CSV
export function toCsvText({ columns, rows }) {
  const q = (v) => { const s = v == null ? "" : String(v); return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return "﻿" + [columns.map((c) => q(c.h)).join(";"), ...rows.map((r) => columns.map((_, i) => q(r[i])).join(";"))].join("\r\n");
}

export const MIME = { xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", pdf: "application/pdf", csv: "text/csv;charset=utf-8" };

/** Descarga un archivo desde el navegador. */
export function downloadBytes(name, bytes, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 3000);
}
export const safeName = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "reporte";
