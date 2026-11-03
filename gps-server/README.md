# Receptor GPS (Rinho) · Panamericano de Jujuy

Servidor que recibe lo que transmiten los GPS Rinho (UDP o TCP, protocolo TAIP de Rinho), lo guarda en Supabase y calcula con eso los viajes, las paradas y las alertas que se ven en **ERP → Flota**. **Corre en un VPS**, no en Vercel (Vercel no recibe UDP/TCP).

```
 Rinho ──UDP/TCP──▶ gps-server (VPS) ──▶ Supabase ◀── /erp (Flota)
        ◀──ACK────        motor de eventos
```

## Qué garantiza

- **No se pierde nada:** el ACK se envía recién después de guardar. Si la base falla, no se confirma y el equipo reintenta (7 s, 4 veces) o, si sigue sin conexión, guarda en su memoria (más de 12.000 posiciones) y la vuelca al volver.
- **Sin duplicados:** un reporte repetido (reintento, o memoria volcada) se guarda una sola vez.
- **Solo equipos cargados:** lo que mande un equipo que no está en ERP → Flota → Vehículos se ignora (sin ACK) y queda registrado para vincularlo.
- **El motor de eventos es una función pura** (`engine.js`): se prueba con recorridos simulados y se puede reproducir sobre el historial.

## Archivos

| Archivo | Para qué |
|---|---|
| `taip.js` | Protocolo Rinho: tramas, checksum, ACK, todos los reportes (CQ, CP, CR, CV, CT, CU, BQ, BR, BV, HQ, HR, HV, EQ, ER), RVR, KA, AP/PA. Basado en la *Guía de Integración v1.2*. |
| `engine.js`, `geo.js` | Geocercas, viajes, paradas (frena o no), atraso, sentido, desvío de ruta, velocidad, detenciones, falta de señal. |
| `server.js`, `store.js`, `index.js` | Servidor UDP/TCP, guardado por lotes en Supabase y arranque. |
| `sim-device.js`, `sim-route.js`, `simulate.js` | Simulador de un equipo (UDP/TCP, reintentos, memoria) para probar sin el aparato. |
| `deploy/` | Instalación en el VPS (`install.sh`) y servicio de systemd. |
| `test/` | Más de 70 pruebas: protocolo, motor, base de datos, exportación y servidor de punta a punta (UDP, TCP, reintentos, caída de la base, reportes desordenados, reinicio abrupto). |

## Probarlo en tu computadora (sin VPS, sin equipo)

```bash
npm install                      # en la raíz del repositorio
npm run test:gps                 # corre todas las pruebas
```

## Instalar en el VPS

1. Crear un VPS Ubuntu 22.04 o 24.04 (1 vCPU y 1 GB alcanzan para 30 coches) con **IP pública fija**.
2. Conectarse por SSH y ejecutar:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/diegodasilva272013-commits/panamericano_web/main/gps-server/deploy/install.sh | sudo bash
   ```
3. Completar la clave: `sudo nano /opt/panamericano/gps-server/.env` → `SUPABASE_SERVICE_ROLE_KEY=` (la clave de servicio **nueva**, nunca la que se pegó en un chat). Después `sudo systemctl restart gps-receptor`.
4. Ver que esté vivo: `curl -s http://127.0.0.1:8081` (debe decir `"ready": true`) y `journalctl -u gps-receptor -f`.
5. En Supabase → SQL Editor ejecutar `supabase/flota.sql` (después de los otros cuatro archivos).

El instalador abre en el firewall solo SSH y el puerto 4031 (UDP y TCP).

## Configurar cada Rinho

Con el configurador web (https://config.rinho.com.ar, por cable USB) o por comando, apuntar el equipo al servidor:

```
>SIP0"IP-o-dominio-del-VPS",4031<
```

y definir los envíos (los recomienda el propio fabricante): reporte cada **5–10 s con el motor encendido**, un intervalo más largo con el motor apagado y un reporte extra en cada cambio de rumbo. Para la memoria sin conexión conviene que descargue **primero lo más antiguo**, así los viajes se reconstruyen en orden.

Después, en ERP → Flota → Vehículos, cargar cada coche con el **IMEI** del equipo (viene en cada trama; los equipos desconocidos aparecen ahí para vincularlos con un clic).

## Primer equipo real: qué vigilar

La guía del fabricante tiene dos puntos que solo un equipo real puede confirmar:

1. **El checksum.** La guía describe el cálculo (XOR de `>` hasta `*`) pero los checksums de sus ejemplos no coinciden con ese cálculo. Por eso arranca en `CHECKSUM=warn`: acepta y cuenta (`badChecksum` en `curl http://127.0.0.1:8081`). Si con el equipo real el contador queda en 0, pasar a `CHECKSUM=strict`. Si no, el registro muestra las tramas para ajustar el cálculo.
2. **Campos de telemetría.** Los ejemplos de la guía son inconsistentes en satélites, PDOP y antigüedad del GPS. Posición, velocidad, rumbo, ignición, voltaje y odómetro coinciden con el servidor de ejemplo del fabricante.

## Seguridad

- El protocolo no tiene cifrado ni autenticación: cualquiera que conozca un IMEI podría mandar tramas. Por eso se aceptan solo IMEIs cargados y se pone el firewall del VPS. Si las SIM son de un operador con rango de IPs fijo, se puede restringir el puerto a ese rango.
- La clave de servicio solo vive en el `.env` del VPS (permisos 600). El servicio corre con un usuario sin privilegios.
