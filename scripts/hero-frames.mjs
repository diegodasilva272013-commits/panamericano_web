#!/usr/bin/env node
// Genera la secuencia de cuadros del hero a partir de assets-src/panamericano/sequence.json
// (misma tecnica que el hero de /propuesta-payma: manifest.json + f_0001.webp...).
// Uso: node scripts/hero-frames.mjs
// Todo lo especifico (clips, fundido, tamanos, fps) vive en sequence.json.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'assets-src', 'panamericano');
const cfg = JSON.parse(fs.readFileSync(path.join(SRC, 'sequence.json'), 'utf-8'));
const OUT = path.join(ROOT, cfg.salida);
const FFMPEG = 'ffmpeg', FFPROBE = 'ffprobe';
const FPS_IN = 24;

const probeDur = (f) => Number(execFileSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path.join(SRC, f)]).toString().trim());
const clips = cfg.clips.map((c) => ({ ...c, dur: probeDur(c.archivo) }));
const fade = cfg.fundido_s;
const totalDur = clips.reduce((a, c, i) => a + c.dur - (i > 0 ? fade : 0), 0);

// instante (en fraccion 0..1 del recorrido) en que cae cada fundido
const cortes = [];
let off = clips[0].dur;
for (let i = 1; i < clips.length; i++) { off -= fade; cortes.push(Number(((off + fade / 2) / totalDur).toFixed(4))); off += clips[i].dur; }

function filter(juego) {
  const parts = [];
  clips.forEach((c, i) => {
    const chain = [
      'setpts=PTS-STARTPTS', `fps=${FPS_IN}`, 'settb=1/24',
      juego.recorte ? `crop=${juego.recorte}` : null,
      `scale=${juego.ancho}:-2:flags=lanczos`, 'format=yuv420p', 'setsar=1',
    ].filter(Boolean).join(',');
    parts.push(`[${i}:v]${chain}[c${i}]`);
  });
  let last = 'c0', offset = clips[0].dur;
  for (let i = 1; i < clips.length; i++) {
    offset -= fade;
    const out = i === clips.length - 1 ? 'joined' : `x${i}`;
    parts.push(`[${last}][c${i}]xfade=transition=fade:duration=${fade}:offset=${offset.toFixed(3)}[${out}]`);
    last = out; offset += clips[i].dur;
  }
  parts.push(`[joined]fps=${cfg.fps_salida}[out]`);
  return parts.join(';');
}

const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
const mpath = path.join(OUT, 'manifest.json');
const manifest = (only && fs.existsSync(mpath)) ? JSON.parse(fs.readFileSync(mpath, 'utf-8')) : { count: 0, juegos: {} };
Object.assign(manifest, { fps: cfg.fps_salida, duracion_s: Number(totalDur.toFixed(2)), patron: 'f_%04d.webp', cortes });
for (const j of cfg.juegos.filter((x) => !only || x.nombre === only)) {
  const dir = path.join(OUT, j.nombre);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  execFileSync(FFMPEG, ['-v', 'error', '-y', ...clips.flatMap((c) => ['-i', path.join(SRC, c.archivo)]),
    '-filter_complex', filter(j), '-map', '[out]', '-c:v', 'libwebp', '-quality', String(j.calidad), '-compression_level', '6',
    path.join(dir, 'f_%04d.webp')], { stdio: 'inherit' });
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.webp')).sort();
  const bytes = files.reduce((a, f) => a + fs.statSync(path.join(dir, f)).size, 0);
  const [w, h] = execFileSync(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path.join(dir, files[0])]).toString().trim().split(',').map(Number);
  manifest.count = files.length;
  manifest.juegos[j.nombre] = { ancho: w, alto: h, bytes };
  console.log(`${j.nombre}: ${files.length} cuadros, ${(bytes / 1048576).toFixed(1)} MB, ${w}x${h}`);
}
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
// poster / LCP = primer cuadro de desktop
if (!only || only === 'desktop') fs.copyFileSync(path.join(OUT, 'desktop', 'f_0001.webp'), path.join(ROOT, 'public', 'panamericano', 'hero-poster.webp'));
console.log(`manifest: ${manifest.count} cuadros, ${manifest.duracion_s}s, cortes en`, cortes.join(', '));
