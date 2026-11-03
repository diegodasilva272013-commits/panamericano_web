-- =====================================================================================
--  PANAMERICANO · Flota (GPS)
--  Pegar TODO este archivo en: Supabase > SQL Editor > New query > Run.
--  Va DESPUÉS de schema.sql, booking.sql, erp.sql y pagos.sql. Se puede volver a ejecutar sin perder datos.
--  Lo escribe el servidor receptor (gps-server, con la clave de servicio); el ERP solo lee y administra.
-- =====================================================================================

-- 1) VEHÍCULOS --------------------------------------------------------------------------
-- Un vehículo es un coche físico con un equipo GPS. device_id es el identificador que el equipo manda en cada trama (el IMEI).
create table if not exists public.vehicles (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,            -- como lo llama el personal: "INT 110"
  plate      text not null default '',
  device_id  text unique,                      -- IMEI del equipo; vacío = todavía sin equipo
  bus_id     text,                             -- id del coche en el panel (plano de asientos)
  active     boolean not null default true,
  notes      text not null default '',
  created_at timestamptz not null default now(),
  constraint vehicles_code_largo check (length(btrim(code)) between 1 and 40)
);
alter table public.vehicles enable row level security;

-- 2) POSICIONES: una fila por reporte del equipo ----------------------------------------
-- La clave única hace que un reporte repetido (el equipo reintenta si no recibe el ACK, o vuelca su memoria al recuperar señal) no se duplique.
create table if not exists public.gps_positions (
  id          bigint generated always as identity primary key,
  vehicle_id  uuid not null references public.vehicles(id) on delete cascade,
  device_id   text not null,
  event_time  timestamptz not null,             -- hora GPS del equipo
  received_at timestamptz not null default now(),
  report_id   text not null default '',
  lat         double precision not null,
  lng         double precision not null,
  speed       smallint not null default 0,      -- km/h
  course      smallint not null default 0,
  ignition    boolean not null default false,
  voltage     real,
  odometer_m  bigint,
  sats        smallint,
  pdop        smallint,
  csq         smallint,
  gsm         smallint,
  rtype       text not null default 'CQ',
  extra       jsonb,
  constraint gps_positions_unico unique (device_id, event_time, report_id)
);
create index if not exists gps_positions_vehiculo_idx on public.gps_positions (vehicle_id, event_time desc);
create index if not exists gps_positions_tiempo_idx on public.gps_positions (event_time);
alter table public.gps_positions enable row level security;

-- 3) ESTADO ACTUAL de cada vehículo (una fila por vehículo; es lo que mira el mapa en vivo) ----
create table if not exists public.vehicle_state (
  vehicle_id    uuid primary key references public.vehicles(id) on delete cascade,
  last_time     timestamptz,                    -- hora GPS de la última posición
  last_received timestamptz,
  lat           double precision,
  lng           double precision,
  speed         smallint,
  course        smallint,
  ignition      boolean,
  voltage       real,
  odometer_m    bigint,
  sats          smallint,
  csq           smallint,
  trip_id       uuid,
  inside        uuid[] not null default '{}',   -- geocercas en las que está ahora
  engine        jsonb not null default '{}'::jsonb, -- estado interno del motor de eventos (para retomar tras un reinicio)
  updated_at    timestamptz not null default now()
);
alter table public.vehicle_state enable row level security;

-- 4) GEOCERCAS: paradas, terminales, zonas con límite de velocidad y zonas prohibidas ----
create table if not exists public.geofences (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  kind        text not null default 'parada' check (kind in ('parada', 'terminal', 'zona', 'restringida')),
  shape       text not null default 'circle' check (shape in ('circle', 'polygon')),
  lat         double precision,
  lng         double precision,
  radius_m    int check (radius_m is null or radius_m between 20 and 20000),
  polygon     jsonb,                            -- [[lat, lng], ...] (al menos 3 puntos)
  speed_limit int check (speed_limit is null or speed_limit between 5 and 160), -- solo para zonas
  color       text not null default '#f4b400',
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  constraint geofences_forma check (
    (shape = 'circle' and lat between -90 and 90 and lng between -180 and 180 and radius_m is not null)
    or (shape = 'polygon' and jsonb_typeof(polygon) = 'array' and jsonb_array_length(polygon) >= 3))
);
alter table public.geofences enable row level security;

-- 5) RECORRIDOS: cada servicio del panel con su trazado y sus paradas en orden ----------
-- route_id es el id del servicio en el panel (el mismo que usan las reservas). idx 0 = origen, 1.. = paradas, igual que las reservas.
create table if not exists public.fleet_routes (
  route_id   text primary key,
  polyline   jsonb not null default '[]'::jsonb,  -- [[lat, lng], ...] trazado de la ruta; sirve para el sentido y para medir cuánto avanzó
  corridor_m int not null default 400 check (corridor_m between 50 and 5000),
  updated_at timestamptz not null default now()
);
alter table public.fleet_routes enable row level security;
create table if not exists public.fleet_route_stops (
  route_id    text not null references public.fleet_routes(route_id) on delete cascade,
  idx         int not null check (idx >= 0),
  geofence_id uuid not null references public.geofences(id) on delete restrict,
  name        text not null,
  offset_min  int check (offset_min is null or offset_min >= 0), -- minutos desde la salida en que debería llegar (vacío = no se mide el atraso en esa parada)
  mandatory   boolean not null default true,                      -- si no frena ahí, se avisa
  primary key (route_id, idx)
);
alter table public.fleet_route_stops enable row level security;

-- 6) VIAJES: una salida de un servicio con el coche asignado ------------------------------
create table if not exists public.fleet_trips (
  id             uuid primary key default gen_random_uuid(),
  route_id       text not null,
  trip_date      date not null,
  trip_time      text not null,
  vehicle_id     uuid references public.vehicles(id) on delete set null,
  status         text not null default 'programado' check (status in ('programado', 'en_curso', 'completado', 'cancelado')),
  planned_at     timestamptz,                   -- salida programada
  started_at     timestamptz,
  ended_at       timestamptz,
  last_stop_idx  int,
  distance_m     bigint,
  max_speed      smallint,
  created_at     timestamptz not null default now(),
  constraint fleet_trips_unico unique (route_id, trip_date, trip_time)
);
create index if not exists fleet_trips_fecha_idx on public.fleet_trips (trip_date, status);
create index if not exists fleet_trips_vehiculo_idx on public.fleet_trips (vehicle_id, trip_date);
alter table public.fleet_trips enable row level security;

create table if not exists public.fleet_trip_stops (
  trip_id     uuid not null references public.fleet_trips(id) on delete cascade,
  idx         int not null,
  geofence_id uuid,
  name        text not null default '',
  planned_at  timestamptz,
  arrived_at  timestamptz,
  departed_at timestamptz,
  dwell_s     int,
  delay_min   int,                              -- positivo = llegó tarde
  status      text not null default 'pendiente' check (status in ('pendiente', 'ok', 'omitida')),
  primary key (trip_id, idx)
);
alter table public.fleet_trip_stops enable row level security;

-- 7) EVENTOS de geocercas y ALERTAS -------------------------------------------------------
create table if not exists public.geofence_events (
  id          bigint generated always as identity primary key,
  vehicle_id  uuid not null references public.vehicles(id) on delete cascade,
  geofence_id uuid not null references public.geofences(id) on delete cascade,
  kind        text not null check (kind in ('entra', 'sale')),
  at          timestamptz not null,
  lat         double precision,
  lng         double precision,
  speed       smallint,
  trip_id     uuid
);
create index if not exists geofence_events_vehiculo_idx on public.geofence_events (vehicle_id, at desc);
-- Rehacer un viaje desde el historial (cuando llegan posiciones viejas tarde) vuelve a generar los mismos eventos: no se duplican.
create unique index if not exists geofence_events_unico on public.geofence_events (vehicle_id, geofence_id, kind, at);
create index if not exists geofence_events_geocerca_idx on public.geofence_events (geofence_id, at desc);
alter table public.geofence_events enable row level security;

-- Una alerta es un episodio (por ejemplo, todo un tramo pasado de velocidad). key identifica el episodio para no repetirlo.
create table if not exists public.fleet_alerts (
  id         uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  trip_id    uuid,
  key        text not null,
  kind       text not null,                     -- exceso_velocidad, sentido_contrario, fuera_de_ruta, parada_omitida, atraso, sin_senal, geocerca_restringida, bateria, detenido
  severity   text not null default 'aviso' check (severity in ('info', 'aviso', 'critica')),
  title      text not null,
  detail     text not null default '',
  data       jsonb not null default '{}'::jsonb,
  started_at timestamptz not null,
  updated_at timestamptz not null default now(),
  ended_at   timestamptz,
  lat        double precision,
  lng        double precision,
  ack_at     timestamptz,
  ack_by     uuid,
  constraint fleet_alerts_episodio unique (vehicle_id, key)
);
create index if not exists fleet_alerts_abiertas_idx on public.fleet_alerts (started_at desc) where ack_at is null;
create index if not exists fleet_alerts_vehiculo_idx on public.fleet_alerts (vehicle_id, started_at desc);
alter table public.fleet_alerts enable row level security;

-- 8) AJUSTES de la flota (una sola fila) --------------------------------------------------
create table if not exists public.fleet_settings (
  id   text primary key default 'main' check (id = 'main'),
  data jsonb not null default '{}'::jsonb
);
alter table public.fleet_settings enable row level security;
insert into public.fleet_settings (id, data) values ('main', jsonb_build_object(
  'speedLimit', 90,        -- km/h, límite general
  'speedGraceS', 10,       -- segundos por encima del límite antes de avisar
  'noSignalMin', 10,       -- minutos sin datos de un coche en servicio para avisar
  'delayTolMin', 5,        -- minutos de atraso que se toleran
  'stopRadiusM', 120,      -- radio por defecto de una parada
  'idleStopMin', 15,       -- minutos detenido fuera de una parada, en viaje, para avisar
  'lowVoltage', 11.0,      -- voltios: por debajo se avisa batería baja
  'retentionDays', 30      -- cuántos días se guarda el detalle de las posiciones
)) on conflict (id) do nothing;

-- 8b) DOCUMENTOS de cada vehículo y sus vencimientos (VTV, seguro, habilitación...) -------------
create table if not exists public.vehicle_documents (
  id         uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  kind       text not null,                     -- "VTV", "Seguro", "Habilitación"...
  number     text not null default '',
  expires_on date not null,
  notes      text not null default '',
  created_at timestamptz not null default now(),
  constraint vehicle_documents_tipo_largo check (length(btrim(kind)) between 1 and 60)
);
create index if not exists vehicle_documents_vence_idx on public.vehicle_documents (expires_on);
alter table public.vehicle_documents enable row level security;

-- 8c) Los gastos del ERP se pueden asignar a un coche concreto (para el informe de gastos por coche). Opcional.
alter table public.expenses add column if not exists vehicle_id uuid references public.vehicles(id) on delete set null;
create index if not exists expenses_vehiculo_idx on public.expenses (vehicle_id) where vehicle_id is not null;

-- 9) PERMISOS: solo administradores leen y cambian; el servidor receptor usa la clave de servicio ----------
do $$
declare t text;
begin
  foreach t in array array['vehicles', 'gps_positions', 'vehicle_state', 'geofences', 'fleet_routes', 'fleet_route_stops', 'fleet_trips', 'fleet_trip_stops', 'geofence_events', 'fleet_alerts', 'fleet_settings', 'vehicle_documents'] loop
    execute format('drop policy if exists "admin ve %1$s" on public.%1$I', t);
    execute format('create policy "admin ve %1$s" on public.%1$I for select to authenticated using (public.is_admin())', t);
  end loop;
  -- lo que se edita desde el ERP
  foreach t in array array['vehicles', 'geofences', 'fleet_routes', 'fleet_route_stops', 'fleet_trips', 'fleet_trip_stops', 'fleet_settings', 'vehicle_documents'] loop
    execute format('drop policy if exists "admin escribe %1$s" on public.%1$I', t);
    execute format('create policy "admin escribe %1$s" on public.%1$I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
  -- las alertas solo se pueden "atender" (ack); las crea el motor de eventos
  drop policy if exists "admin atiende fleet_alerts" on public.fleet_alerts;
  create policy "admin atiende fleet_alerts" on public.fleet_alerts for update to authenticated using (public.is_admin()) with check (public.is_admin());
end $$;
revoke all on public.vehicles, public.gps_positions, public.vehicle_state, public.geofences, public.fleet_routes, public.fleet_route_stops, public.fleet_trips, public.fleet_trip_stops, public.geofence_events, public.fleet_alerts, public.fleet_settings, public.vehicle_documents from anon;
grant select on public.vehicles, public.gps_positions, public.vehicle_state, public.geofences, public.fleet_routes, public.fleet_route_stops, public.fleet_trips, public.fleet_trip_stops, public.geofence_events, public.fleet_alerts, public.fleet_settings, public.vehicle_documents to authenticated;
grant insert, update, delete on public.vehicles, public.geofences, public.fleet_routes, public.fleet_route_stops, public.fleet_trips, public.fleet_trip_stops, public.fleet_settings, public.vehicle_documents to authenticated;
grant update (ack_at, ack_by) on public.fleet_alerts to authenticated;

-- 10) FUNCIONES DEL SERVIDOR RECEPTOR (solo service_role) ----------------------------------

-- Todo lo que el motor necesita para trabajar: ajustes, vehículos con equipo, geocercas, recorridos y los viajes de hoy y ayer.
create or replace function public.gps_config() returns jsonb language sql security definer set search_path = public stable as
$$
  select jsonb_build_object(
    'settings', coalesce((select data from fleet_settings where id = 'main'), '{}'::jsonb),
    'vehicles', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'code', v.code, 'deviceId', v.device_id)) from vehicles v where v.active and v.device_id is not null), '[]'::jsonb),
    'geofences', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'kind', g.kind, 'shape', g.shape, 'lat', g.lat, 'lng', g.lng, 'radiusM', g.radius_m, 'polygon', g.polygon, 'speedLimit', g.speed_limit)) from geofences g where g.active), '[]'::jsonb),
    'routes', coalesce((select jsonb_agg(jsonb_build_object('routeId', r.route_id, 'polyline', r.polyline, 'corridorM', r.corridor_m,
        'stops', coalesce((select jsonb_agg(jsonb_build_object('idx', s.idx, 'geofenceId', s.geofence_id, 'name', s.name, 'offsetMin', s.offset_min, 'mandatory', s.mandatory) order by s.idx)
                            from fleet_route_stops s where s.route_id = r.route_id), '[]'::jsonb))) from fleet_routes r), '[]'::jsonb),
    'trips', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'routeId', t.route_id, 'date', t.trip_date, 'time', t.trip_time, 'vehicleId', t.vehicle_id, 'status', t.status, 'plannedAt', t.planned_at, 'startedAt', t.started_at))
                         from fleet_trips t where t.vehicle_id is not null and t.status in ('programado', 'en_curso') and t.trip_date between (now() at time zone 'America/Argentina/Jujuy')::date - 1 and (now() at time zone 'America/Argentina/Jujuy')::date + 1), '[]'::jsonb),
    'states', coalesce((select jsonb_agg(jsonb_build_object('vehicleId', s.vehicle_id, 'engine', s.engine, 'lastTime', s.last_time)) from vehicle_state s), '[]'::jsonb),
    'now', now()
  );
$$;

-- Guarda un lote ya procesado por el motor, todo junto: si algo falla no queda nada a medias (y el equipo, al no recibir el ACK, reintenta).
create or replace function public.gps_save(p jsonb) returns jsonb language plpgsql security definer set search_path = public as
$$
declare n_pos int := 0; v_r record;
begin
  -- Reconstrucción: cuando el receptor rehace un coche desde el historial (llegaron posiciones atrasadas), primero se borra lo derivado en esa
  -- ventana (eventos, alertas sin atender, paradas y el avance del viaje) para que el resultado final sea el correcto, sin restos de una lectura incompleta.
  for v_r in select (x ->> 'vehicleId')::uuid as vid, (x ->> 'from')::timestamptz as f, coalesce(x -> 'tripIds', '[]'::jsonb) as ids from jsonb_array_elements(coalesce(p -> 'rebuild', '[]'::jsonb)) x loop
    delete from geofence_events where vehicle_id = v_r.vid and at >= v_r.f;
    delete from fleet_alerts where vehicle_id = v_r.vid and started_at >= v_r.f and ack_at is null and kind <> 'sin_senal';
    delete from fleet_trip_stops where trip_id in (select i::uuid from jsonb_array_elements_text(v_r.ids) i);
    update fleet_trips set status = 'programado', started_at = null, ended_at = null, last_stop_idx = null, distance_m = null, max_speed = null
     where id in (select i::uuid from jsonb_array_elements_text(v_r.ids) i) and status <> 'cancelado';
  end loop;

  insert into gps_positions (vehicle_id, device_id, event_time, report_id, lat, lng, speed, course, ignition, voltage, odometer_m, sats, pdop, csq, gsm, rtype, extra)
  select (x ->> 'vehicleId')::uuid, x ->> 'deviceId', (x ->> 't')::timestamptz, coalesce(x ->> 'reportId', ''), (x ->> 'lat')::float8, (x ->> 'lng')::float8,
         coalesce((x ->> 'speed')::smallint, 0), coalesce((x ->> 'course')::smallint, 0), coalesce((x ->> 'ign')::boolean, false), (x ->> 'voltage')::real,
         (x ->> 'odometerM')::bigint, (x ->> 'sats')::smallint, (x ->> 'pdop')::smallint, (x ->> 'csq')::smallint, (x ->> 'gsm')::smallint, coalesce(x ->> 'rtype', 'CQ'), x -> 'extra'
    from jsonb_array_elements(coalesce(p -> 'positions', '[]'::jsonb)) x
  on conflict (device_id, event_time, report_id) do nothing;
  get diagnostics n_pos = row_count;

  -- estado actual: nunca retrocede (una posición vieja que llega tarde no pisa a una más nueva)
  insert into vehicle_state (vehicle_id, last_time, last_received, lat, lng, speed, course, ignition, voltage, odometer_m, sats, csq, trip_id, inside, engine, updated_at)
  select distinct on ((x ->> 'vehicleId')::uuid) (x ->> 'vehicleId')::uuid, (x ->> 't')::timestamptz, now(), (x ->> 'lat')::float8, (x ->> 'lng')::float8, (x ->> 'speed')::smallint, (x ->> 'course')::smallint,
         (x ->> 'ign')::boolean, (x ->> 'voltage')::real, (x ->> 'odometerM')::bigint, (x ->> 'sats')::smallint, (x ->> 'csq')::smallint, nullif(x ->> 'tripId', '')::uuid,
         coalesce((select array_agg(i::uuid) from jsonb_array_elements_text(coalesce(x -> 'inside', '[]'::jsonb)) i), '{}'), coalesce(x -> 'engine', '{}'::jsonb), now()
    from jsonb_array_elements(coalesce(p -> 'state', '[]'::jsonb)) with ordinality as e(x, ord)
   order by (x ->> 'vehicleId')::uuid, (x ->> 't')::timestamptz desc, ord desc
  on conflict (vehicle_id) do update set last_time = excluded.last_time, last_received = excluded.last_received, lat = excluded.lat, lng = excluded.lng, speed = excluded.speed,
         course = excluded.course, ignition = excluded.ignition, voltage = excluded.voltage, odometer_m = excluded.odometer_m, sats = excluded.sats, csq = excluded.csq,
         trip_id = excluded.trip_id, inside = excluded.inside, engine = excluded.engine, updated_at = now()
   where vehicle_state.last_time is null or excluded.last_time >= vehicle_state.last_time;

  insert into geofence_events (vehicle_id, geofence_id, kind, at, lat, lng, speed, trip_id)
  select (x ->> 'vehicleId')::uuid, (x ->> 'geofenceId')::uuid, x ->> 'kind', (x ->> 'at')::timestamptz, (x ->> 'lat')::float8, (x ->> 'lng')::float8, (x ->> 'speed')::smallint, nullif(x ->> 'tripId', '')::uuid
    from jsonb_array_elements(coalesce(p -> 'events', '[]'::jsonb)) x
   where exists (select 1 from geofences g where g.id = (x ->> 'geofenceId')::uuid)
  on conflict (vehicle_id, geofence_id, kind, at) do nothing;

  -- viajes: arrancan, avanzan y terminan
  update fleet_trips t set status = coalesce(x ->> 'status', t.status), started_at = coalesce((x ->> 'startedAt')::timestamptz, t.started_at), ended_at = coalesce((x ->> 'endedAt')::timestamptz, t.ended_at),
         last_stop_idx = coalesce((x ->> 'lastStopIdx')::int, t.last_stop_idx), distance_m = coalesce((x ->> 'distanceM')::bigint, t.distance_m), max_speed = greatest(t.max_speed, (x ->> 'maxSpeed')::smallint)
    from jsonb_array_elements(coalesce(p -> 'trips', '[]'::jsonb)) x
   where t.id = (x ->> 'id')::uuid;

  insert into fleet_trip_stops (trip_id, idx, geofence_id, name, planned_at, arrived_at, departed_at, dwell_s, delay_min, status)
  select distinct on ((x ->> 'tripId')::uuid, (x ->> 'idx')::int)  -- si el lote trae la misma parada dos veces, gana la última
         (x ->> 'tripId')::uuid, (x ->> 'idx')::int, nullif(x ->> 'geofenceId', '')::uuid, coalesce(x ->> 'name', ''), (x ->> 'plannedAt')::timestamptz, (x ->> 'arrivedAt')::timestamptz,
         (x ->> 'departedAt')::timestamptz, (x ->> 'dwellS')::int, (x ->> 'delayMin')::int, coalesce(x ->> 'status', 'pendiente')
    from jsonb_array_elements(coalesce(p -> 'stops', '[]'::jsonb)) with ordinality as e(x, ord)
   where exists (select 1 from fleet_trips t where t.id = (x ->> 'tripId')::uuid)
   order by (x ->> 'tripId')::uuid, (x ->> 'idx')::int, ord desc
  on conflict (trip_id, idx) do update set
         arrived_at = case when fleet_trip_stops.arrived_at is null then excluded.arrived_at when excluded.arrived_at is null then fleet_trip_stops.arrived_at else least(fleet_trip_stops.arrived_at, excluded.arrived_at) end,
         departed_at = case when fleet_trip_stops.departed_at is null then excluded.departed_at when excluded.departed_at is null then fleet_trip_stops.departed_at else greatest(fleet_trip_stops.departed_at, excluded.departed_at) end,
         planned_at = coalesce(excluded.planned_at, fleet_trip_stops.planned_at),
         geofence_id = coalesce(excluded.geofence_id, fleet_trip_stops.geofence_id),
         status = case when excluded.status = 'pendiente' and fleet_trip_stops.status <> 'pendiente' then fleet_trip_stops.status else excluded.status end;
  -- tiempo detenido y atraso se recalculan siempre con los datos finales de la fila
  update fleet_trip_stops set dwell_s = case when arrived_at is not null and departed_at is not null then greatest(0, extract(epoch from departed_at - arrived_at))::int else dwell_s end,
         delay_min = case when idx > 0 and arrived_at is not null and planned_at is not null then round(extract(epoch from arrived_at - planned_at) / 60)::int else delay_min end
   where trip_id in (select (x ->> 'tripId')::uuid from jsonb_array_elements(coalesce(p -> 'stops', '[]'::jsonb)) x);

  -- alertas: un episodio se crea una vez y después solo se actualiza (el "atendida" que marcó el personal se conserva)
  insert into fleet_alerts (vehicle_id, trip_id, key, kind, severity, title, detail, data, started_at, ended_at, lat, lng)
  select distinct on ((x ->> 'vehicleId')::uuid, x ->> 'key')  -- la misma alerta dos veces en el lote: gana la última
         (x ->> 'vehicleId')::uuid, nullif(x ->> 'tripId', '')::uuid, x ->> 'key', x ->> 'kind', coalesce(x ->> 'severity', 'aviso'), x ->> 'title', coalesce(x ->> 'detail', ''), coalesce(x -> 'data', '{}'::jsonb),
         (x ->> 'at')::timestamptz, (x ->> 'endedAt')::timestamptz, (x ->> 'lat')::float8, (x ->> 'lng')::float8
    from jsonb_array_elements(coalesce(p -> 'alerts', '[]'::jsonb)) with ordinality as e(x, ord)
   order by (x ->> 'vehicleId')::uuid, x ->> 'key', ord desc
  on conflict (vehicle_id, key) do update set detail = excluded.detail, data = excluded.data, updated_at = now(), severity = excluded.severity,
         ended_at = coalesce(excluded.ended_at, fleet_alerts.ended_at);

  return jsonb_build_object('positions', n_pos);
end;
$$;

-- Posiciones guardadas de un vehículo desde un instante, en orden (el receptor las usa para rehacer un viaje y para retomar tras un reinicio).
create or replace function public.gps_positions_since(p_vehicle uuid, p_from timestamptz, p_limit int default 20000) returns jsonb language sql security definer set search_path = public stable as
$$
  select coalesce(jsonb_agg(jsonb_build_object('t', event_time, 'lat', lat, 'lng', lng, 'speed', speed, 'course', course, 'ign', ignition, 'voltage', voltage, 'odometerM', odometer_m, 'sats', sats, 'csq', csq) order by event_time), '[]'::jsonb)
    from (select * from gps_positions where vehicle_id = p_vehicle and event_time > p_from order by event_time limit greatest(1, least(p_limit, 50000))) q;
$$;

-- Distancias diarias por coche (reporte): kilómetros, tiempo en marcha y detenido con motor, velocidades y primer/último dato, por día de Jujuy.
-- Los kilómetros se suman entre posiciones consecutivas; un hueco de más de 5 minutos (se perdió la señal) no se cuenta.
-- Solo administradores (a cualquier otro le devuelve vacío).
create or replace function public.fleet_daily(p_from date, p_to date, p_vehicles uuid[] default null)
returns table (day date, vehicle_id uuid, code text, km numeric, moving_min numeric, idle_min numeric, max_speed int, avg_speed numeric, positions int, first_at timestamptz, last_at timestamptz)
language sql security definer set search_path = public stable as
$$
  with p as (
    select g.vehicle_id as vid, g.event_time as t, g.speed, g.lat, g.lng,
           (g.event_time at time zone 'America/Argentina/Jujuy')::date as d,
           lag(g.lat) over w as plat, lag(g.lng) over w as plng, lag(g.event_time) over w as pt, lag(g.speed) over w as pspeed, lag(g.ignition) over w as pign
      from gps_positions g
     where public.is_admin()
       and p_to - p_from <= 93
       and g.event_time >= (p_from::timestamp at time zone 'America/Argentina/Jujuy')
       and g.event_time <  ((p_to + 1)::timestamp at time zone 'America/Argentina/Jujuy')
       and (p_vehicles is null or g.vehicle_id = any (p_vehicles))
    window w as (partition by g.vehicle_id order by g.event_time)),
  s as (
    select p.*, extract(epoch from (t - pt)) as dt,
           6371008.8 * 2 * asin(least(1, sqrt(power(sin(radians(lat - plat) / 2), 2) + cos(radians(plat)) * cos(radians(lat)) * power(sin(radians(lng - plng) / 2), 2)))) as dist
      from p)
  select s.d, s.vid, v.code,
         round((coalesce(sum(s.dist) filter (where s.dt is not null and s.dt <= 300), 0) / 1000.0)::numeric, 1),
         round((coalesce(sum(s.dt) filter (where s.dt <= 300 and s.pspeed >= 5), 0) / 60.0)::numeric, 0),
         round((coalesce(sum(s.dt) filter (where s.dt <= 300 and s.pspeed < 5 and s.pign), 0) / 60.0)::numeric, 0),
         max(s.speed)::int, round((avg(s.speed) filter (where s.speed >= 5))::numeric, 1), count(*)::int, min(s.t), max(s.t)
    from s join vehicles v on v.id = s.vid
   group by s.d, s.vid, v.code
   order by s.d, v.code;
$$;
grant execute on function public.fleet_daily(date, date, uuid[]) to authenticated;
revoke all on function public.fleet_daily(date, date, uuid[]) from public, anon;

-- Borra el detalle de posiciones más viejo que los días configurados (los viajes, paradas, eventos y alertas se conservan).
create or replace function public.gps_purge(p_days int default null) returns bigint language plpgsql security definer set search_path = public as
$$
declare v_days int; v_n bigint;
begin
  v_days := greatest(7, coalesce(p_days, (select (data ->> 'retentionDays')::int from fleet_settings where id = 'main'), 30));
  delete from gps_positions where event_time < now() - make_interval(days => v_days);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Marca en el panel un vehículo como "visto" sin mover nada: lo usa el servidor para registrar un equipo desconocido (queda a la vista para vincularlo).
create table if not exists public.gps_unknown_devices (
  device_id  text primary key,
  first_seen timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  frames     bigint not null default 1,
  sample     text
);
alter table public.gps_unknown_devices enable row level security;
drop policy if exists "admin ve gps_unknown_devices" on public.gps_unknown_devices;
create policy "admin ve gps_unknown_devices" on public.gps_unknown_devices for select to authenticated using (public.is_admin());
revoke all on public.gps_unknown_devices from anon;
grant select on public.gps_unknown_devices to authenticated;
create or replace function public.gps_unknown(p jsonb) returns void language sql security definer set search_path = public as
$$
  insert into gps_unknown_devices (device_id, sample, frames)
  select x ->> 'deviceId', left(x ->> 'sample', 300), coalesce((x ->> 'frames')::bigint, 1) from jsonb_array_elements(coalesce(p, '[]'::jsonb)) x
  on conflict (device_id) do update set last_seen = now(), frames = gps_unknown_devices.frames + excluded.frames, sample = excluded.sample;
$$;

-- El panel marca una alerta como atendida (registra quién fue).
create or replace function public.fleet_ack_alert(p_id uuid) returns void language plpgsql security definer set search_path = public as
$$
begin
  if not public.is_admin() then raise exception 'SIN_PERMISO'; end if;
  update fleet_alerts set ack_at = now(), ack_by = auth.uid() where id = p_id and ack_at is null;
end;
$$;
grant execute on function public.fleet_ack_alert(uuid) to authenticated;

-- 11) Solo el servidor (service_role) puede ejecutar las funciones del receptor ---------------
revoke all on function public.gps_config() from public, anon, authenticated;
revoke all on function public.gps_save(jsonb) from public, anon, authenticated;
revoke all on function public.gps_purge(int) from public, anon, authenticated;
revoke all on function public.gps_unknown(jsonb) from public, anon, authenticated;
revoke all on function public.gps_positions_since(uuid, timestamptz, int) from public, anon, authenticated;
revoke all on function public.fleet_ack_alert(uuid) from public, anon;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant usage on schema public to service_role;
    grant execute on function public.gps_config() to service_role;
    grant execute on function public.gps_save(jsonb) to service_role;
    grant execute on function public.gps_purge(int) to service_role;
    grant execute on function public.gps_unknown(jsonb) to service_role;
    grant execute on function public.gps_positions_since(uuid, timestamptz, int) to service_role;
  end if;
end $$;

-- 12) Mapa en vivo: el ERP se entera de los cambios al instante (si falla, el ERP igual consulta cada pocos segundos) --------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.vehicle_state; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.fleet_alerts; exception when duplicate_object then null; end;
  end if;
end $$;
