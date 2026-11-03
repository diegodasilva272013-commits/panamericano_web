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
- `src/content/defaults.js` · TODO el contenido por defecto (textos, horarios, destinos, fotos, hero). Es lo que se ve si el panel no guardó nada
- `src/scripts/data.js`, `content.js`, `config.js` · lectura del contenido editable (base de datos) con respaldo en `defaults.js`
- `src/scripts/hero-scroll.js` · hero con secuencia de cuadros según el scroll
- `admin.html` + `src/admin/` · **panel de administración** (`/admin`)
- `supabase/schema.sql` · tablas, permisos y almacenamiento del panel
- `tools/mock-supabase.mjs` · servidor de prueba que imita Supabase (para probar el panel sin cuenta)
- `src/scripts/journey.js` · "El viaje": perfil de altura de la Ruta 9
- `src/scripts/schedule.js`, `booking.js`, `data.js` · tablero de salidas, reserva y datos (horarios, destinos, boleterías)
- `src/scripts/voice.js`, `whatsapp.js` · llamada con el asistente de voz y chat de WhatsApp
- `public/panamericano/frames/` · 476 cuadros del hero (desktop 1600 px, mobile 720 px cuadrado) + `manifest.json`

## Panel de administración (`/admin`)
Permite editar sin tocar el código: **textos** de toda la web, **horarios y servicios**, **destinos**, **fotos** (subir, cambiar y agregar), **boleterías y contacto**, **preguntas frecuentes** y el **hero** (textos y video nuevo). Cada cambio se publica al instante, hay historial para volver atrás y las imágenes se optimizan solas al subirlas.

### Instalación (una sola vez, ~10 minutos)
1. **Crear el proyecto**: en [supabase.com](https://supabase.com) crear una cuenta y un proyecto nuevo (región São Paulo).
2. **Crear tablas y permisos**: *SQL Editor → New query* → pegar todo `supabase/schema.sql` → *Run*.
3. **Crear tu usuario**: *Authentication → Users → Add user* (email y contraseña). Después, en *Authentication → Sign In / Providers → Email*, **desactivar el alta de usuarios nuevos** ("Allow new users to sign up").
4. **Darte permiso de administrador**: en el *SQL Editor* ejecutar la última sentencia de `schema.sql` (está comentada) con tu email. Para sumar a otra persona: crear su usuario y repetir con su email.
5. **Conectar la web**: *Settings → API* → copiar **Project URL** y la clave **anon public**. En Vercel: *Settings → Environment Variables* → agregar `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` → *Redeploy*.
6. Entrar a `https://TU-SITIO/admin` con el usuario del paso 3.

> La clave *anon* es pública por diseño. La seguridad la dan las reglas de `schema.sql`: cualquiera puede **leer** el contenido, pero solo los usuarios de la tabla `admins` pueden **modificarlo** o subir archivos.

### Cómo se usa
- **Guardar y publicar** (arriba a la derecha) publica todo lo editado. Si algo está mal escrito (un horario, un teléfono, la cantidad de fotos), avisa antes de publicar.
- **Historial** guarda las últimas 30 versiones: se puede cargar una anterior en el editor y publicarla.
- **Fotos de la grilla**: tienen que ser múltiplo de 3 (6, 9, 12 o 15) para que la animación quede completa.
- **Horarios**: cada servicio tiene su origen, sus paradas y sus horarios, separados por coma. Si una salida solo va ciertos días: `14:15 (mar · jue · vie)`.
- **Video nuevo para el hero** (*Inicio y hero → Cambiar el video del hero*): subir los videos de cada tramo (MP4 horizontal, 5–12 s), ponerles título y tocar *Generar el hero*. El propio navegador los une con fundido y crea los cuadros (escritorio y celular). Hacerlo desde una compu con **Chrome o Edge** y buena conexión: tarda unos minutos y sube unos 75 MB. Recién cuando se toca *Usar este hero* y *Guardar y publicar* cambia la web. *Borrar versiones anteriores* libera espacio.

### Reservas de asientos

Las reservas son reales: cada asiento ocupado queda guardado en la base y la web lo muestra ocupado a todos.

1. **Una sola vez:** en Supabase > SQL Editor pegá y ejecutá `supabase/booking.sql` (después de `schema.sql`). Se puede volver a ejecutar sin borrar reservas.
2. En el panel, **Coches y reglas**: armá el plano de asientos de cada coche (filas, asientos por fila, pasillo; tocá un lugar para sacar o poner un asiento) y definí las reglas (máximo de asientos por reserva, hasta cuántos días antes, cuándo se cierra). Si no cargás ninguno rige un coche de 44 asientos.
3. En **Horarios de salida**, dentro de cada servicio ("Datos del servicio"): elegí el coche, si se puede reservar por la web y las tarifas por parada (el precio desde el origen hasta cada parada; el tramo cuesta la diferencia).
4. En **Reservas** se ve, por día y por salida, quién reservó cada asiento. Las reservas de la web llegan como *Pendiente*: se confirman, se cancelan (el asiento queda libre) o se borran. También se cargan reservas a mano (teléfono, boletería), se cierra una salida y se busca por código, nombre, teléfono o DNI. **Esta pantalla guarda al instante; no hace falta publicar.** Lo de Coches y reglas sí se publica como el resto.

Cómo está protegido: la web pública solo puede *ver qué asientos están ocupados* (sin datos personales) y *reservar* mediante una función que valida todo en el servidor (asiento que existe, tramo y fecha válidos, salida abierta, máximo de asientos, datos del pasajero, freno si alguien hace demasiadas reservas seguidas). La base impide por sí misma vender dos veces el mismo asiento en el mismo tramo, aunque dos personas aprieten al mismo tiempo. Solo los administradores ven los datos personales de las reservas.

Pruebas de la base: la lógica del SQL se probó contra una base Postgres real (casos de choques de asientos, tramos, permisos y abusos).

### Gestión: reservas, cobros y finanzas (`/erp`)

Es la parte de **gestión de la empresa**, separada del editor de la web (`/admin`). Entra con el mismo usuario administrador y no toca el contenido del sitio.

1. **Una sola vez:** en Supabase > SQL Editor pegá y ejecutá `supabase/erp.sql` (después de `schema.sql` y `booking.sql`). Solo crea dos tablas (`payments` y `expenses`), no cambia ni borra nada; se puede volver a ejecutar.
2. Pantallas: **Inicio** (lo del día y lo que hay que resolver), **Reservas** (todas, con búsqueda, filtros y ficha de cada una), **Salidas** (planilla de pasajeros por salida, imprimible), **Pasajeros** (historial por persona), **Cobros** (cobros registrados, por cobrar y a devolver), **Gastos** y **Finanzas** (resultado del mes, por servicio, libro de caja).
3. Cada reserva tiene su cuenta: total (suma de las tarifas de sus asientos), cobros (seña + saldo, en efectivo, transferencia, Mercado Pago o tarjeta) y saldo. Cancelar una reserva ya cobrada la deja *A devolver* hasta registrar la devolución.
4. Todo se puede exportar a Excel (CSV con separador `;`).

Criterios: *Cobrado* es plata que entró por fecha de cobro (neta de devoluciones); *Vendido* es el valor de los viajes por fecha de viaje. Se cargan los últimos 2 años y todo lo futuro. No hay cobro online: los cobros los registra el personal.

### Pagos online: Mercado Pago y transferencia (Talo)

El pasajero reserva, elige cómo pagar y la reserva se confirma sola cuando entra la plata. Nadie revisa comprobantes. Todo queda registrado en `payments` y se ve en el ERP (los cobros automáticos llevan la marca *Automático*).

**Cómo funciona**
1. El pasajero elige viaje y asiento: el asiento queda retenido el tiempo que se configure (*Coches y reglas → Minutos para pagar*, por ejemplo 30). Si no paga, el asiento se libera solo.
2. Paga con **Mercado Pago** (tarjeta o saldo; la web lo manda a Mercado Pago) o por **transferencia**: la web le muestra un CVU y alias exclusivos de esa reserva (Talo).
3. El proveedor avisa al servidor (`/api/webhooks/mp`, `/api/webhooks/talo`). El servidor **valida la firma** (Mercado Pago) o la clave del enlace (Talo) y **consulta el pago directamente al proveedor** antes de registrar nada. Recién ahí guarda el cobro y confirma la reserva.
4. La pantalla del pasajero se confirma sola. Si el aviso se demora, al consultar el estado el servidor concilia por su cuenta.

**Qué garantiza**
- El monto sale siempre de la base (las tarifas del panel), nunca del navegador.
- Un aviso repetido no duplica el cobro (el par proveedor + número de operación es único en la base).
- Un aviso falso no confirma nada: sin firma válida se ignora, y se verifica contra el proveedor.
- Si la transferencia llega por otro monto (de más o de menos), no se confirma: el ERP avisa en *Inicio* para revisarlo a mano.
- Si el pago llega después de vencida la reserva: si el asiento sigue libre se reabre y se confirma; si ya se vendió a otra persona queda cancelada y el ERP la marca *A devolver*.
- Cada aviso queda en la bitácora `payment_events`.

**Instalación (una sola vez)**
1. En Supabase > SQL Editor ejecutar, en orden: `booking.sql` (se actualizó: agrega el plazo de pago) y `pagos.sql`. Los dos se pueden volver a ejecutar sin perder datos.
2. Cargar las **tarifas** en el panel (*Horarios de salida → cada servicio → tarifas por parada*). Sin tarifa no hay monto para cobrar.
3. En Vercel > Settings > Environment Variables agregar (y volver a desplegar). Ninguna de estas claves va al navegador ni al repositorio:

   | Variable | Qué es |
   |---|---|
   | `SITE_URL` | Dirección pública del sitio, por ejemplo `https://panamericanoweb.vercel.app` |
   | `SUPABASE_SERVICE_ROLE_KEY` | Clave de servicio (secreta) de Supabase. `SUPABASE_URL` se toma de `VITE_SUPABASE_URL` si no se define |
   | `MP_ACCESS_TOKEN` | Access Token de la aplicación de Mercado Pago |
   | `MP_WEBHOOK_SECRET` | Firma secreta de los Webhooks de Mercado Pago |
   | `TALO_MODE` | `sandbox` (pruebas) o `live` (real). Por defecto `sandbox` |
   | `TALO_USER_ID`, `TALO_CLIENT_ID`, `TALO_CLIENT_SECRET` | Credenciales de Talo (panel de Talo > Conexiones) |
   | `TALO_WEBHOOK_KEY` | Una clave larga al azar inventada por nosotros: Talo todavía no firma sus avisos, así que el aviso viaja con esta clave en el enlace |

4. En Mercado Pago > Tus integraciones > Webhooks, cargar la URL `https://TU-SITIO/api/webhooks/mp` con el evento **Pagos** y copiar la firma secreta a `MP_WEBHOOK_SECRET`.
5. Probar **primero en pruebas** (cuentas de prueba de Mercado Pago y `TALO_MODE=sandbox`, con el simulador de transferencias de Talo) y recién después pasar a producción.
6. Cuando todo ande, en *Coches y reglas* poner **Minutos para pagar** (por ejemplo 30). En 0 las reservas no vencen. **No lo actives antes de que los pagos estén funcionando**: las reservas sin pagar se liberarían.

Los botones de pago aparecen solos en la web cuando hay al menos un medio de pago configurado; si no, la reserva sigue como antes (se confirma por WhatsApp o teléfono).

### Flota (GPS): mapa en vivo, viajes, alertas y reportes (`/erp` → Flota)
Los equipos GPS **Rinho** transmiten a un servidor propio (un VPS, no Vercel, porque Vercel no recibe UDP/TCP). Ese servidor guarda en Supabase y calcula viajes, paradas, sentido, velocidad y atrasos; el ERP lo muestra. Todo el detalle (instalación del VPS, configuración de cada equipo, qué vigilar con el primer equipo real) está en [`gps-server/README.md`](gps-server/README.md).

Orden de instalación:
1. En Supabase → SQL Editor, ejecutar `supabase/flota.sql` (después de los otros archivos; se puede volver a ejecutar sin perder datos).
2. En el VPS, instalar el receptor con `gps-server/deploy/install.sh` y completar su `.env` con la clave de servicio **nueva** (nunca en el repositorio).
3. En `/erp` → Flota → **Vehículos**: cargar cada coche con el IMEI de su equipo. Los equipos que transmiten sin estar cargados aparecen solos para vincularlos.
4. **Geocercas y recorridos**: dibujar las paradas y terminales, y enlazar cada servicio de la web con sus paradas y su trazado.
5. **Viajes**: asignar un coche a cada salida del día. Con eso el sistema sigue cada viaje solo.

Probar sin equipo: `npm run test:gps` corre el receptor completo contra un Postgres en memoria con un simulador de equipo, y `node gps-server/simulate.js --port 4031` manda un recorrido por la red a un receptor que estés corriendo.

**Mapa:** usa OpenStreetMap (sin clave) y Esri para satélite. Para un mapa de mejor calidad y sin límites informales de uso, cargar una clave gratuita de MapTiler en la variable `VITE_MAPTILER_KEY` de Vercel.

**Espacio en Supabase:** 30 coches reportando cada 5 a 10 segundos son cientos de miles de filas por día. Por defecto se guarda el detalle 30 días (Flota → Límites y tolerancias) y se conservan para siempre los viajes, paradas, eventos y alertas. Con 30 coches conviene el plan Pro de Supabase.

### Límites del plan gratuito de Supabase (importante)
- **Almacenamiento: 1 GB.** Cada hero nuevo ocupa ~75 MB; borrar las versiones viejas desde el panel.
- **Tráfico: 5 GB por mes.** Las fotos pesan poco, pero **los cuadros de un hero propio los sirve Supabase**: un visitante que recorre todo el hero baja hasta ~52 MB (escritorio) o ~22 MB (celular). El hero original incluido en el sitio se sirve desde Vercel y no tiene este límite.

### Tráfico de los cuadros del hero (recomendado si usan un hero propio)
Para que los cuadros pasen por la red de Vercel (que los guarda en caché) y no gasten el tráfico de Supabase:
1. En `vercel.json` agregar, dentro de la lista, una regla `rewrites` con **el dominio de tu proyecto** (el de *Project URL*):
   ```json
   "rewrites": [{ "source": "/hf/:path*", "destination": "https://TU-PROYECTO.supabase.co/storage/v1/object/public/hero-frames/:path*" }]
   ```
2. En Vercel agregar la variable `VITE_FRAMES_PROXY=/hf` y volver a desplegar.
3. Subir de nuevo el video desde el panel. Para comprobar que funciona, abrir un cuadro (`/hf/<versión>/desktop/f_0001.webp`) y mirar que el encabezado `x-vercel-cache` diga `HIT` a partir de la segunda vez.
Si el sitio llega a tener mucho tráfico, el plan Pro de Supabase sube el límite a 250 GB.

### Probar el panel sin cuenta de Supabase
```bash
node tools/mock-supabase.mjs        # servidor de prueba en :54321 (admin@test.com / secret123)
VITE_SUPABASE_URL=http://localhost:54321 VITE_SUPABASE_ANON_KEY=test npm run dev
```
y abrir `http://localhost:5173/admin`.

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
