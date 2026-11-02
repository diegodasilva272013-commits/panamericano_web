import { h, group, field, toast, confirmBox, kb, icon, plainErr, hooks } from "./ui.js";
import { uploadBlob, publicUrl, BUCKET_FRAMES, listFrameVersions, removeFrameVersion, listHistory } from "./api.js";
import { FRAMES_PROXY } from "../scripts/config.js";

// Convierte los videos que sube el cliente en la secuencia de cuadros del hero, dentro del navegador:
// mismo recorrido que el script scripts/hero-frames.mjs (fundido entre tramos, formato escritorio 1600 px
// y formato celular cuadrado 720 px) y publica los cuadros en Supabase Storage con un número de versión.

const CAN_WEBP = (() => { try { return document.createElement("canvas").toDataURL("image/webp").startsWith("data:image/webp"); } catch { return false; } })();
const OUT = { desktop: { width: 1600, quality: 0.7 }, mobile: { side: 720, quality: 0.64 } };

const fmtT = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
const toBlob = (c, q) => new Promise((r) => c.toBlob(r, "image/webp", q));

function seek(video, t) {
  const target = Math.min(Math.max(0, t), Math.max(0, video.duration - 0.04));
  return new Promise((res, rej) => {
    if (Math.abs(video.currentTime - target) < 0.0005 && video.readyState >= 2) return res();
    const ok = () => { cleanup(); res(); };
    const bad = () => { cleanup(); rej(new Error("No se pudo leer el video.")); };
    const cleanup = () => { video.removeEventListener("seeked", ok); video.removeEventListener("error", bad); };
    video.addEventListener("seeked", ok); video.addEventListener("error", bad);
    video.currentTime = target;
  });
}

async function loadClip(file) {
  const url = URL.createObjectURL(file);
  const video = Object.assign(document.createElement("video"), { src: url, muted: true, playsInline: true, preload: "auto" });
  await new Promise((res, rej) => { video.onloadedmetadata = res; video.onerror = () => rej(new Error(`No se pudo abrir "${file.name}". Probá con otro video (formato MP4).`)); });
  await seek(video, 0.2);
  const t = document.createElement("canvas"); t.width = 160; t.height = Math.round(160 * video.videoHeight / video.videoWidth);
  t.getContext("2d").drawImage(video, 0, 0, t.width, t.height);
  const name = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
  return { file, url, video, dur: video.duration, w: video.videoWidth, h: video.videoHeight, thumb: t.toDataURL("image/jpeg", 0.7), title: "", detail: "", rail: "", name };
}

// El generador conserva su trabajo (videos, progreso, resultado) aunque se cambie de pantalla o se deshaga algo:
// la pantalla se redibuja, pero este bloque es el mismo y solo se vuelve a conectar con el borrador actual.
let KEEP = null;
export const videoBusy = () => !!KEEP?.S.busy;
// al cerrar sesión el generador se descarta (no queda trabajo de otra persona en memoria)
export const resetVideo = () => { KEEP?.S.clips.forEach((c) => { try { URL.revokeObjectURL(c.url); } catch { /* ya liberada */ } }); KEEP = null; };
export const videoProgress = () => KEEP?.S.progress ?? 0;
export const videoHasWork = () => !!KEEP && (KEEP.S.busy || KEEP.S.clips.length > 0 || !!KEEP.S.result);

export function heroVideoTool(ctx) {
  if (KEEP) { KEEP.ref.ctx = ctx; return KEEP.root; }
  const ref = { ctx };
  const D = () => ref.ctx.draft, dirty = () => ref.ctx.dirty(), rerender = () => ref.ctx.rerender();
  const S = { clips: [], fps: 10, fade: 0.6, mobileX: 0.56, busy: false, cancel: false, result: null, progress: 0, version: null };
  const root = h("div", {});
  KEEP = { S, root, ref };

  const msg = h("p", { class: "status", role: "status", "aria-live": "polite" });
  const bar = h("div", { class: "bar", hidden: true }, h("i", {}));
  const clipsBox = h("div", { class: "list" });
  const resultBox = h("div", {});
  const fileIn = h("input", { type: "file", accept: "video/*", multiple: true, hidden: true });
  const genBtn = h("button", { type: "button", class: "btn", onclick: () => generate() }, "Generar el video de la portada");
  const cancelBtn = h("button", { type: "button", class: "btn btn--ghost", hidden: true, onclick: () => { S.cancel = true; } }, "Cancelar");
  const addBtn = h("button", { type: "button", class: "btn btn--ghost", onclick: () => fileIn.click() }, icon("plus", 17), "Agregar videos");

  const setBar = (p) => { S.progress = p; hooks.repaint?.(); bar.hidden = false; bar.firstChild.style.transform = `scaleX(${p})`; };
  const say = (t, kind) => { msg.textContent = t; msg.className = "status" + (kind ? " is-" + kind : ""); };

  function drawClips(keepMsg) {
    addBtn.disabled = S.busy; // mientras se genera no se pueden sumar pasos
    clipsBox.replaceChildren();
    if (!S.clips.length) clipsBox.append(h("p", { class: "empty" }, "Todavía no agregaste videos. Cada video es un paso del viaje."));
    S.clips.forEach((c, i) => {
      const move = (d) => { const j = i + d; if (j < 0 || j >= S.clips.length) return; [S.clips[i], S.clips[j]] = [S.clips[j], S.clips[i]]; drawClips(); };
      clipsBox.append(h("div", { class: "item" },
        h("div", { class: "item__bar" },
          h("strong", {}, `Paso ${i + 1} · ${c.name}`),
          h("span", { class: "item__btns" },
            h("button", { type: "button", class: "ico", disabled: i === 0 || S.busy, onclick: () => move(-1), "aria-label": `Subir el paso ${i + 1}` }, icon("up", 17)),
            h("button", { type: "button", class: "ico", disabled: i === S.clips.length - 1 || S.busy, onclick: () => move(1), "aria-label": `Bajar el paso ${i + 1}` }, icon("down", 17)),
            h("button", { type: "button", class: "ico ico--del", disabled: S.busy, "aria-label": `Quitar el paso ${i + 1}`, onclick: () => { S.clips.splice(i, 1); drawClips(); toast(`Quitaste el paso ${i + 1} (${c.name}).`, "ok", 8000, { label: "Deshacer", run: () => { S.clips.splice(Math.min(i, S.clips.length), 0, c); drawClips(); } }); } }, icon("x", 17)))),
        h("div", { class: "split split--thumb" },
          h("div", { class: "clip__thumb" }, h("img", { src: c.thumb, alt: "" }), h("small", { class: "hint" }, `${fmtT(c.dur)} · ${c.w}×${c.h}`)),
          h("div", { class: "grid3" },
            field({ label: "Título grande del paso", value: c.title, placeholder: "Ej. Purmamarca", onInput: (v) => { c.title = v; } }),
            field({ label: "Detalle", value: c.detail, placeholder: "Ej. Cerro de los Siete Colores", onInput: (v) => { c.detail = v; } }),
            field({ label: "Nombre corto (se ve abajo, en la barra del recorrido)", value: c.rail, placeholder: "Ej. Purmamarca", onInput: (v) => { c.rail = v; } })))));
    });
    const total = S.clips.reduce((a, c, i) => a + c.dur - (i ? S.fade : 0), 0);
    if (!keepMsg) say(S.clips.length ? `${S.clips.length} pasos · duración total del recorrido: ${fmtT(total)}.` : "");
  }

  fileIn.addEventListener("change", async () => {
    if (S.busy) { fileIn.value = ""; return; }
    const files = [...fileIn.files]; fileIn.value = "";
    for (const f of files) {
      if (S.clips.length >= 8) { toast("El máximo es 8 pasos.", "err"); break; }
      say(`Leyendo ${f.name}…`);
      try { S.clips.push(await loadClip(f)); } catch (e) { toast(plainErr(e), "err", 7000); }
    }
    drawClips();
  });

  async function generate() {
    if (S.busy) return;
    const errs = [];
    if (!CAN_WEBP) errs.push("Este navegador no puede crear las imágenes. Usá Chrome o Edge en una computadora.");
    if (!S.clips.length) errs.push("Agregá al menos un video.");
    S.clips.forEach((c, i) => { if (!c.title.trim()) errs.push(`Al paso ${i + 1} le falta el título.`); if (c.dur < S.fade * 2 + 0.5) errs.push(`El paso ${i + 1} es demasiado corto (mínimo ${(S.fade * 2 + 0.5).toFixed(1)} s).`); });
    const clips = S.clips, n = clips.length, fps = S.fps, fade = S.fade;
    const starts = []; let acc = 0; clips.forEach((c, i) => { starts.push(acc); acc += c.dur - (i < n - 1 ? fade : 0); });
    const total = starts[n - 1] + clips[n - 1].dur;
    if (total > 150) errs.push("El recorrido total supera los 150 segundos. Acortá los videos.");
    if (errs.length) { toast(errs.length > 1 ? `Hay ${errs.length} cosas para arreglar: ${errs.map((e, i) => `${i + 1}) ${e}`).join(" ")}` : errs[0], "err", 14000); return; }
    if (!(await confirmBox(`Se van a generar y subir ${(Math.floor(total * fps) + 1) * 2} imágenes (unos ${Math.round((Math.floor(total * fps) + 1) * 0.16)} MB). Tarda varios minutos: no cierres esta pestaña ni la computadora. ¿Empezar?`, "Empezar"))) return;

    S.busy = true; S.cancel = false; cleanBtn.disabled = true; genBtn.disabled = true; cancelBtn.hidden = false; resultBox.replaceChildren(); drawClips(); hooks.repaint?.();
    const N = Math.floor(total * fps) + 1;
    const version = Date.now().toString(36); S.version = version; // desde ya queda protegida del borrado de versiones viejas
    const w0 = clips[0].w, h0 = clips[0].h;
    const base = document.createElement("canvas"); base.width = w0; base.height = h0; const bx = base.getContext("2d");
    const dW = Math.min(OUT.desktop.width, w0), dH = Math.round(dW * h0 / w0);
    const cd = document.createElement("canvas"); cd.width = dW; cd.height = dH; const cdx = cd.getContext("2d");
    const side = Math.min(OUT.mobile.side, h0);
    const cm = document.createElement("canvas"); cm.width = side; cm.height = side; const cmx = cm.getContext("2d");
    const crop = h0; const cropX = Math.round(Math.max(0, w0 - h0) * S.mobileX);

    const cover = (v) => { const s = Math.max(w0 / v.videoWidth, h0 / v.videoHeight); const dw = v.videoWidth * s, dh = v.videoHeight * s; bx.drawImage(v, (w0 - dw) / 2, (h0 - dh) / 2, dw, dh); };

    // subida en paralelo con tope
    const pool = new Set(); let uploaded = 0; const totalFiles = N * 2 + 2; let upErr = null;
    const push = (path, blob) => {
      const p = uploadBlob(BUCKET_FRAMES, `${version}/${path}`, blob, "image/webp").then(() => { uploaded++; }, (e) => { upErr = e; }).finally(() => pool.delete(p));
      pool.add(p); return p;
    };
    const room = async () => { while (pool.size >= 6) await Promise.race(pool); if (upErr) throw upErr; };

    const thumbs = {}; let first = null;
    try {
      for (let i = 0; i < N; i++) {
        if (S.cancel) throw new Error("cancelado");
        const t = Math.min(i / fps, total - 0.001);
        let k = 0; for (let j = 0; j < n; j++) if (starts[j] <= t + 1e-9) k = j;
        await seek(clips[k].video, t - starts[k]);
        bx.globalAlpha = 1; cover(clips[k].video);
        if (k < n - 1 && t >= starts[k + 1]) {
          await seek(clips[k + 1].video, t - starts[k + 1]);
          bx.globalAlpha = Math.min(1, (t - starts[k + 1]) / fade); cover(clips[k + 1].video); bx.globalAlpha = 1;
        }
        cdx.drawImage(base, 0, 0, dW, dH);
        cmx.drawImage(base, cropX, 0, crop, crop, 0, 0, side, side);
        const [bd, bm] = await Promise.all([toBlob(cd, OUT.desktop.quality), toBlob(cm, OUT.mobile.quality)]);
        if (!bd || !bm || bd.type !== "image/webp") throw new Error("El navegador no pudo crear las imágenes. Usá Chrome o Edge.");
        const name = `f_${String(i + 1).padStart(4, "0")}.webp`;
        if (i === 0) first = { bd, bm };
        if (i === 0 || i === Math.floor(N / 2) || i === N - 1) thumbs[i] = URL.createObjectURL(bd);
        await room(); push(`desktop/${name}`, bd); push(`mobile/${name}`, bm);
        setBar(((i + 1) / N) * 0.5 + (uploaded / totalFiles) * 0.5);
        say(`Procesando cuadro ${i + 1} de ${N} · subidos ${uploaded} de ${totalFiles - 2}`);
      }
      await push("poster.webp", first.bd); await push("poster-mobile.webp", first.bm);
      while (pool.size) await Promise.race(pool);
      if (upErr) throw upErr;
      setBar(1);
      const cortes = starts.slice(1).map((s) => Number(((s + fade / 2) / total).toFixed(4)));
      S.result = {
        version, count: N, cortes,
        base: FRAMES_PROXY ? `${FRAMES_PROXY.replace(/\/$/, "")}/${version}` : publicUrl(BUCKET_FRAMES, version).replace(/\/$/, ""),
        poster: publicUrl(BUCKET_FRAMES, `${version}/poster.webp`), posterMobile: publicUrl(BUCKET_FRAMES, `${version}/poster-mobile.webp`),
        etapas: clips.map((c, i) => ({ clip: i, rail: c.rail.trim() || c.title.trim(), title: c.title.trim(), detail: c.detail.trim() })),
      };
      say(`Listo: ${N} cuadros por formato subidos. Revisá las vistas previas y tocá "Usar este video".`, "ok");
      if (!root.isConnected) toast("El video de la portada está listo. Entrá a «Portada y video» para usarlo.", "ok", 15000);
      showResult(thumbs);
    } catch (e) {
      if (e.message === "cancelado") say("Se canceló. No se cambió nada en la web.", "bad");
      else { say("No se pudo terminar: " + plainErr(e), "bad"); toast(plainErr(e), "err", 9000); }
    } finally {
      S.busy = false; genBtn.disabled = false; cancelBtn.hidden = true; drawClips(true); hooks.repaint?.(); // no pisar el mensaje final
    }
  }

  function showResult(thumbs) {
    const r = S.result;
    resultBox.replaceChildren(h("div", { class: "result" },
      h("div", { class: "thumbs" }, Object.keys(thumbs).sort((a, b) => a - b).map((k) => h("img", { src: thumbs[k], alt: `Cuadro ${+k + 1}` }))),
      h("div", { class: "result__act" },
        h("button", { type: "button", class: "btn", onclick: () => {
          D().hero.frames = { base: r.base, count: r.count, cortes: r.cortes, patron: "f_%04d.webp", v: r.version };
          D().hero.poster = r.poster; D().hero.posterMobile = r.posterMobile; D().hero.etapas = r.etapas;
          dirty(); toast("Video nuevo cargado en el editor. Tocá \"Guardar y publicar\" para que se vea en la web.", "ok", 8000); rerender();
        } }, "Usar este video"),
        h("small", { class: "hint" }, "Los cuadros ya están subidos pero la web no cambia hasta que guardes."))));
  }

  const cleanBtn = h("button", { type: "button", class: "btn btn--ghost", onclick: async () => {
    try {
      const keep = new Set([D().hero.frames?.v, S.result?.version, S.version, ref.ctx.published?.()?.hero?.frames?.v].filter(Boolean)); // en vivo, en el borrador y recién generada
      try { (await listHistory()).forEach((r) => { const v = r.data?.hero?.frames?.v; if (v) keep.add(v); }); } // y las de las últimas publicaciones
      catch { return toast("No se pudo comprobar qué versiones usan las publicaciones anteriores, así que no se borró nada. Probá de nuevo.", "err", 8000); }
      try { const d = JSON.parse(localStorage.getItem("pm-admin-draft") || "null"); const v = d?.data?.hero?.frames?.v; if (v) keep.add(v); } catch { /* sin borrador guardado */ } // y la del borrador guardado en este navegador
      const all = await listFrameVersions();
      const joven = (v) => { const t = parseInt(v, 36); return Number.isFinite(t) && Date.now() - t < 48 * 3600 * 1000; }; // nunca se borra lo de las últimas 48 horas
      const old = all.filter((v) => !keep.has(v) && !joven(v));
      if (!old.length) return toast("No hay versiones anteriores para borrar.");
      if (!(await confirmBox(`Hay ${old.length} ${old.length === 1 ? "versión vieja" : "versiones viejas"} del video que ya no usa nadie. Se van a borrar para liberar espacio. No se tocan la que está en la web, la que estás armando ni las de las últimas publicaciones (para poder volver atrás). ¿Seguir?`, "Borrar"))) return;
      cleanBtn.disabled = true; for (const v of old) await removeFrameVersion(v);
      toast(`Se borraron ${old.length} versiones anteriores.`);
    } catch (e) { toast(plainErr(e), "err"); } finally { cleanBtn.disabled = S.busy; }
  } }, "Borrar versiones anteriores");

  drawClips();
  root.append(group("Cambiar el video de la portada",
    "La portada es un recorrido que avanza al deslizar. Para cambiarlo, subí un video por cada paso del viaje (en orden): el panel los une con una transición y arma el recorrido completo.",
    h("ul", { class: "tips" },
      h("li", {}, "Formato: MP4 horizontal (16:9), de 1280 px de ancho o más. Sin audio no hace falta."),
      h("li", {}, "Entre 2 y 8 pasos de 5 a 12 segundos cada uno. Más largo = más pesado."),
      h("li", {}, "Hacelo desde una computadora con Chrome o Edge y buena conexión: tarda varios minutos y sube unos 75 MB."),
      h("li", {}, "La web actual no se toca hasta que toques \"Guardar y publicar\".")),
    !CAN_WEBP && h("p", { class: "status is-bad" }, "Este navegador no puede crear las imágenes de la portada. Abrí el panel en Chrome o Edge."),
    h("div", { class: "list__add" }, addBtn, fileIn),
    clipsBox,
    h("details", { class: "adv" }, h("summary", {}, "Opciones avanzadas"),
      h("div", { class: "grid3" },
        field({ label: "Suavidad del movimiento", help: "Cuántas imágenes por segundo tiene el recorrido. Más suave pesa más y tarda más en cargar.", type: "number", value: S.fps, hint: "10 es lo recomendado (entre 6 y 15).", onInput: (v) => { S.fps = Math.min(15, Math.max(6, +v || 10)); drawClips(); } }),
        field({ label: "Transición entre videos (segundos)", help: "Cuánto tardan en mezclarse un paso con el siguiente.", type: "number", value: S.fade, hint: "0,6 es lo recomendado.", onInput: (v) => { S.fade = Math.min(2, Math.max(0.2, +v || 0.6)); drawClips(); } }),
        field({ label: "Parte del video que se ve en el celular", help: "El celular muestra un cuadrado del video. 0 es el borde izquierdo y 1 el derecho.", type: "number", value: S.mobileX, hint: "0 = izquierda, 1 = derecha. 0,56 centra un poco a la derecha.", onInput: (v) => { S.mobileX = Math.min(1, Math.max(0, +v || 0.56)); } }))),
    bar, msg,
    h("div", { class: "list__add" }, genBtn, cancelBtn, cleanBtn),
    resultBox));
  return root;
}
