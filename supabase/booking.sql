-- =====================================================================================
--  PANAMERICANO · Sistema de reservas de asientos
--  Pegar TODO este archivo en: Supabase > SQL Editor > New query > Run.
--  Va DESPUÉS de schema.sql. Se puede volver a ejecutar sin romper nada ni borrar reservas.
-- =====================================================================================

create extension if not exists btree_gist;

-- 1) RESERVAS: una fila por asiento -----------------------------------------------------
-- Un asiento está ocupado solo entre donde sube y donde baja el pasajero (from_idx -> to_idx,
-- 0 = origen del servicio, 1.. = paradas en orden). Después de que baja, el asiento vuelve a estar libre.
create table if not exists public.reservations (
  id             uuid primary key default gen_random_uuid(),
  code           text not null,
  route_id       text not null,
  trip_date      date not null,
  trip_time      text not null,
  from_idx       int  not null,
  to_idx         int  not null,
  from_name      text not null,
  to_name        text not null,
  seat           text not null,
  passenger_name text not null,
  passenger_doc  text not null default '',
  phone          text not null default '',
  email          text not null default '',
  fare           numeric,
  status         text not null default 'pendiente' check (status in ('pendiente', 'confirmada', 'cancelada')),
  note           text not null default '',
  source         text not null default 'web' check (source in ('web', 'admin')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint reservations_tramo check (from_idx >= 0 and from_idx < to_idx),
  -- la base misma impide vender dos veces el mismo asiento en el mismo tramo, aunque dos personas aprieten a la vez
  constraint reservations_sin_doble_venta exclude using gist (
    route_id with =, trip_date with =, trip_time with =, seat with =, int4range(from_idx, to_idx) with &&
  ) where (status <> 'cancelada')
);
create index if not exists reservations_viaje_idx  on public.reservations (route_id, trip_date, trip_time);
create index if not exists reservations_codigo_idx on public.reservations (code);
create index if not exists reservations_fecha_idx  on public.reservations (trip_date);
create index if not exists reservations_tel_idx    on public.reservations (phone, created_at);
alter table public.reservations enable row level security;

create or replace function public.reservations_touch() returns trigger language plpgsql as
$$ begin new.updated_at = now(); return new; end; $$;
drop trigger if exists reservations_touch_trg on public.reservations;
create trigger reservations_touch_trg before update on public.reservations for each row execute function public.reservations_touch();

-- solo los administradores ven y tocan reservas (datos personales); la web pública usa las funciones de abajo
drop policy if exists "admin ve reservas" on public.reservations;
create policy "admin ve reservas" on public.reservations for select to authenticated using (public.is_admin());
drop policy if exists "admin crea reservas" on public.reservations;
create policy "admin crea reservas" on public.reservations for insert to authenticated with check (public.is_admin());
drop policy if exists "admin cambia reservas" on public.reservations;
create policy "admin cambia reservas" on public.reservations for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin borra reservas" on public.reservations;
create policy "admin borra reservas" on public.reservations for delete to authenticated using (public.is_admin());

-- 2) SALIDAS CERRADAS (coche roto, feriado, cupo cerrado): ahí no se puede reservar -------
create table if not exists public.closed_trips (
  id         uuid primary key default gen_random_uuid(),
  route_id   text not null,
  trip_date  date not null,
  trip_time  text,                       -- vacío = todo el día de ese servicio
  reason     text not null default '',
  created_at timestamptz not null default now()
);
create unique index if not exists closed_trips_uni on public.closed_trips (route_id, trip_date, coalesce(trip_time, ''));
alter table public.closed_trips enable row level security;
drop policy if exists "admin maneja salidas cerradas" on public.closed_trips;
create policy "admin maneja salidas cerradas" on public.closed_trips for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- 3) FUNCIONES PARA LA WEB PÚBLICA ---------------------------------------------------------
-- Hora de Jujuy "ahora" como fecha y como minutos desde medianoche.
create or replace function public.jujuy_now() returns timestamp language sql stable as
$$ select now() at time zone 'America/Argentina/Jujuy'; $$;

-- Asientos ocupados de una salida (sin datos personales) y si está cerrada.
create or replace function public.trip_info(p_route text, p_date date, p_time text)
returns jsonb language sql security definer set search_path = public stable as
$$
  select jsonb_build_object(
    'closed', exists (select 1 from closed_trips c where c.route_id = p_route and c.trip_date = p_date and (c.trip_time is null or c.trip_time = p_time)),
    'taken', coalesce((select jsonb_agg(jsonb_build_object('seat', r.seat, 'from', r.from_idx, 'to', r.to_idx))
                         from reservations r
                        where r.route_id = p_route and r.trip_date = p_date and r.trip_time = p_time and r.status <> 'cancelada'), '[]'::jsonb)
  );
$$;
grant execute on function public.trip_info(text, date, text) to anon, authenticated;

-- Coche estándar por defecto (11 filas de 2 + pasillo + 2 = 44 asientos). Igual al de src/content/defaults.js.
create or replace function public.default_buses() returns jsonb language sql immutable as
$$ select jsonb_build_array(jsonb_build_object('id', 'coche-44', 'name', 'Coche común · 44 asientos', 'rows',
     (select jsonb_agg(jsonb_build_array((i*4+1)::text, (i*4+2)::text, null, (i*4+3)::text, (i*4+4)::text) order by i) from generate_series(0, 10) i))); $$;

-- Reservar. Valida TODO en el servidor (no se confía en lo que manda el navegador).
-- p_people: [{"name": "...", "doc": "..."}] uno por asiento, en el mismo orden que p_seats.
create or replace function public.book_seats(
  p_route text, p_date date, p_time text, p_from int, p_to int,
  p_seats text[], p_people jsonb, p_phone text, p_email text default ''
) returns jsonb language plpgsql security definer set search_path = public as
$$
declare
  v_data    jsonb;
  v_route   jsonb;
  v_bus     jsonb;
  v_buses   jsonb;
  v_stops   jsonb;
  v_n       int;
  v_cfg     jsonb;
  v_max     int;
  v_ahead   int;
  v_cut     int;
  v_now     timestamp := public.jujuy_now();
  v_dep     timestamp;
  v_valid   text[];
  v_code    text;
  v_seat    text;
  v_i       int;
  v_name    text;
  v_doc     text;
  v_fare    numeric;
  v_fares   jsonb;
  v_pa      numeric;
  v_pb      numeric;
  v_phone   text := btrim(coalesce(p_phone, ''));
  v_email   text := btrim(coalesce(p_email, ''));
begin
  select data into v_data from site_content where id = 'main';
  if v_data is null then raise exception 'NO_DISPONIBLE:Las reservas todavía no están configuradas.'; end if;
  v_cfg := coalesce(v_data -> 'booking', '{}'::jsonb);
  if coalesce((v_cfg ->> 'enabled')::boolean, true) = false then raise exception 'NO_DISPONIBLE:Las reservas por la web están pausadas. Escribinos por WhatsApp.'; end if;
  v_max   := coalesce((v_cfg ->> 'maxSeats')::int, 6);
  v_ahead := coalesce((v_cfg ->> 'daysAhead')::int, 60);
  v_cut   := coalesce((v_cfg ->> 'cutoffMinutes')::int, 30);

  select r into v_route from jsonb_array_elements(coalesce(v_data -> 'routes', '[]'::jsonb)) r where r ->> 'id' = p_route limit 1;
  if v_route is null then raise exception 'DATOS:Ese servicio no existe.'; end if;
  if coalesce((v_route ->> 'bookable')::boolean, true) = false then raise exception 'NO_DISPONIBLE:Ese servicio no se reserva por la web. Consultá en boletería.'; end if;
  if not (coalesce(v_route -> 'times', '[]'::jsonb) ? p_time) then raise exception 'DATOS:Ese horario no existe.'; end if;

  -- paradas en orden: 0 = origen del servicio
  v_stops := jsonb_build_array(v_route ->> 'from') || coalesce(v_route -> 'stops', '[]'::jsonb);
  v_n := jsonb_array_length(v_stops);
  if p_from is null or p_to is null or p_from < 0 or p_to >= v_n or p_from >= p_to then raise exception 'DATOS:El tramo elegido no es válido.'; end if;

  -- fecha y hora
  if p_date is null or p_date < v_now::date then raise exception 'DATOS:Esa fecha ya pasó.'; end if;
  if p_date > v_now::date + v_ahead then raise exception 'DATOS:Todavía no se puede reservar para esa fecha (hasta % días antes).', v_ahead; end if;
  v_dep := p_date::timestamp + (p_time || ':00')::interval;
  if v_dep < v_now + make_interval(mins => v_cut) then raise exception 'DATOS:Esa salida ya está por salir o salió. Elegí otra.'; end if;
  if (public.trip_info(p_route, p_date, p_time) ->> 'closed')::boolean then raise exception 'CERRADA:Esa salida está cerrada. Elegí otra o consultá en boletería.'; end if;

  -- asientos: existen en el coche de ese servicio, sin repetir, cantidad permitida
  -- si el panel todavía no guardó coches, rige el estándar de 44 asientos (el mismo que muestra la web por defecto)
  v_buses := coalesce(nullif(v_data -> 'buses', '[]'::jsonb), public.default_buses());
  select b into v_bus from jsonb_array_elements(v_buses) b
   where b ->> 'id' = coalesce(v_route ->> 'busId', (v_buses -> 0) ->> 'id') limit 1;
  if v_bus is null then v_bus := v_buses -> 0; end if;  -- el coche asignado fue borrado: se usa el primero (igual que la web)
  select coalesce(array_agg(s), '{}') into v_valid
    from jsonb_array_elements(v_bus -> 'rows') row_, jsonb_array_elements_text(row_) s where s is not null and s <> '';
  -- (los pasillos son null en el JSON; jsonb_array_elements_text los devuelve como NULL y el filtro los descarta)
  if p_seats is null or cardinality(p_seats) < 1 then raise exception 'DATOS:Elegí al menos un asiento.'; end if;
  if cardinality(p_seats) > v_max then raise exception 'DATOS:Se pueden reservar hasta % asientos por vez.', v_max; end if;
  if (select count(distinct x) from unnest(p_seats) x) <> cardinality(p_seats) then raise exception 'DATOS:Hay un asiento repetido.'; end if;
  foreach v_seat in array p_seats loop
    if not (v_seat = any (v_valid)) then raise exception 'DATOS:El asiento % no existe en este coche.', v_seat; end if;
  end loop;

  -- pasajeros
  if jsonb_typeof(p_people) <> 'array' or jsonb_array_length(p_people) <> cardinality(p_seats) then raise exception 'DATOS:Falta cargar los datos de cada pasajero.'; end if;
  if v_phone !~ '^[+0-9][0-9 ()-]{6,}$' then raise exception 'DATOS:Revisá el teléfono.'; end if;
  if v_email <> '' and v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'DATOS:Revisá el email.'; end if;
  if length(v_phone) > 30 or length(v_email) > 120 then raise exception 'DATOS:Teléfono o email demasiado largo.'; end if;

  -- freno a abusos: muchas reservas pendientes seguidas con el mismo teléfono
  if (select count(*) from reservations where phone = v_phone and source = 'web' and status = 'pendiente' and created_at > now() - interval '1 hour') + cardinality(p_seats) > v_max * 3 then
    raise exception 'DEMASIADAS:Hiciste muchas reservas seguidas. Escribinos por WhatsApp para completar.';
  end if;

  -- tarifa: precio acumulado desde el origen en cada parada (el tramo cuesta la diferencia)
  v_fares := coalesce(v_route -> 'fares', '{}'::jsonb);
  v_pa := case when p_from = 0 then 0 else (v_fares ->> (v_stops ->> p_from))::numeric end;
  v_pb := (v_fares ->> (v_stops ->> p_to))::numeric;
  v_fare := case when v_pb is not null and v_pa is not null and v_pb > v_pa then v_pb - v_pa else null end;

  -- código legible, sin letras que se confunden
  loop
    v_code := 'PB-' || upper(translate(substr(md5(random()::text || clock_timestamp()::text), 1, 6), '01oil', '23abc'));
    exit when not exists (select 1 from reservations where code = v_code);
  end loop;

  for v_i in 1 .. cardinality(p_seats) loop
    v_name := btrim(coalesce(p_people -> (v_i - 1) ->> 'name', ''));
    v_doc  := btrim(coalesce(p_people -> (v_i - 1) ->> 'doc', ''));
    if length(v_name) < 3 or length(v_name) > 80 or v_name !~ '\s' then raise exception 'DATOS:Escribí nombre y apellido del pasajero %.', v_i; end if;
    if v_doc !~ '^[A-Za-z0-9.-]{6,20}$' then raise exception 'DATOS:Revisá el documento del pasajero %.', v_i; end if;
    begin
      insert into reservations (code, route_id, trip_date, trip_time, from_idx, to_idx, from_name, to_name, seat, passenger_name, passenger_doc, phone, email, fare, source)
      values (v_code, p_route, p_date, p_time, p_from, p_to, v_stops ->> p_from, v_stops ->> p_to, p_seats[v_i], v_name, v_doc, v_phone, v_email, v_fare, 'web');
    exception when exclusion_violation then
      raise exception 'SEAT_TAKEN:%', p_seats[v_i];  -- revierte todo: no queda ningún asiento a medias
    end;
  end loop;

  return jsonb_build_object('code', v_code, 'seats', to_jsonb(p_seats), 'fare', v_fare, 'total', case when v_fare is null then null else v_fare * cardinality(p_seats) end);
end;
$$;
grant execute on function public.book_seats(text, date, text, int, int, text[], jsonb, text, text) to anon, authenticated;
