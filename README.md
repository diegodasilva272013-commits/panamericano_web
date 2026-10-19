# Panamericano Bus · web de demostración

Sitio de demostración para **Panamericano de Jujuy S.A.** (transporte de pasajeros por la Ruta 9, de San Salvador de Jujuy a La Quiaca): horarios en vivo, reserva online (demo), asistente de voz con ElevenLabs y contacto por WhatsApp.

## Ejecutar
```bash
npm install
npm run dev      # desarrollo
npm run build    # produce dist/
```

## Estructura
- `index.html` y `src/styles/` · maquetación y estilos
- `src/scripts/hero-scroll.js` + `hero.config.js` · hero con secuencia de cuadros según el scroll (contenido y rutas en la config)
- `src/scripts/journey.js` · "El viaje": perfil de altura de la Ruta 9
- `src/scripts/schedule.js`, `booking.js`, `data.js` · tablero de salidas, reserva y datos (horarios, destinos, boleterías)
- `src/scripts/voice.js`, `whatsapp.js` · llamada con el asistente de voz y chat de WhatsApp
- `public/panamericano/frames/` · 476 cuadros del hero (desktop 1600 px, mobile 720 px cuadrado) + `manifest.json`

## Regenerar los frames del hero
Los videos fuente (5 clips 1920×1080, 24 fps) no están en el repo por peso. Dejarlos en `assets-src/panamericano/` con los nombres de `sequence.json` y correr:
```bash
node scripts/hero-frames.mjs            # desktop + mobile
node scripts/hero-frames.mjs --only mobile
```
Requiere `ffmpeg` con soporte WebP.

## Datos a validar antes de publicar
Horarios, destinos, teléfonos y boleterías salen de fuentes públicas (relevados el 18/10/2026) y **no del sitio oficial**. Las alturas del perfil de la Ruta 9 son aproximadas. La reserva es una demo: no guarda datos ni cobra; la solicitud se confirma por WhatsApp.

## Base y licencia
El efecto "sticky grid" de la sección *Conectamos caminos* está basado en [codrops-sticky-grid-scroll](https://github.com/theoplawinski/codrops-sticky-grid-scroll) de Theo Plawinski (licencia MIT). Ver `LICENSE-NOTE.txt`.
