-- =====================================================================================
--  PANAMERICANO · Pagos online (Mercado Pago y transferencia por Talo)
--  Pegar TODO este archivo en: Supabase > SQL Editor > New query > Run.
--  Va DESPUÉS de schema.sql, booking.sql y erp.sql. Solo CREA cosas (y agrega dos columnas a payments):
--  no borra ni cambia reservas ni cobros que ya existan, y se puede volver a ejecutar.
-- =====================================================================================

-- 1) Los cobros saben de qué proveedor vinieron. El par (proveedor, número de operación) es único:
--    si Mercado Pago o Talo avisan dos veces lo mismo, el cobro se registra UNA sola vez.
alter table public.payments add column if not exists provider text check (provider in ('mercadopago', 'talo'));
alter table public.payments add column if not exists provider_ref text;
create unique index if not exists payments_provider_ref_uni on public.payments (provider, provider_ref) where provider_ref is not null;

-- 2) Órdenes de pago: qué link o qué CVU se le dio a cada reserva.
create table if not exists public.payment_orders (
  id           uuid primary key default gen_random_uuid(),
  code         text not null,
  provider     text not null check (provider in ('mercadopago', 'talo')),
  provider_ref text not null,                                  -- Mercado Pago: id de la preferencia · Talo: id del pago
  amount       numeric(12, 2) not null check (amount > 0),
  state        text not null default 'pendiente' check (state in ('pendiente', 'pagada', 'vencida', 'revision')),
  data         jsonb not null default '{}'::jsonb,             -- link de pago, CVU, alias, vencimiento
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (provider, provider_ref)
);
create index if not exists payment_orders_code_idx on public.payment_orders (code);
alter table public.payment_orders enable row level security;

-- 3) Bitácora de avisos de los proveedores: qué llegó, si era auténtico y qué se hizo. Sirve para auditar.
create table if not exists public.payment_events (
  id       uuid primary key default gen_random_uuid(),
  at       timestamptz not null default now(),
  provider text not null,
  kind     text not null,                                      -- aviso, revision, error, firma_invalida, conciliacion
  ref      text not null default '',
  ok       boolean not null default true,
  detail   text not null default '',
  payload  jsonb
);
create index if not exists payment_events_at_idx on public.payment_events (at desc);
alter table public.payment_events enable row level security;

-- Solo los administradores pueden VER esto (el servidor escribe con su clave interna, que no pasa por estas reglas).
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'payment_orders' and policyname = 'admin ve ordenes de pago') then
    create policy "admin ve ordenes de pago" on public.payment_orders for select to authenticated using (public.is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'payment_events' and policyname = 'admin ve avisos de pago') then
    create policy "admin ve avisos de pago" on public.payment_events for select to authenticated using (public.is_admin());
  end if;
end
$$;

-- 4) FUNCIONES. Las "pay_..." las ejecuta SOLO el servidor de la web (clave de servicio): nadie desde el navegador.

-- Total que se debe de una reserva: suma de las tarifas de sus asientos vivos (o de los liberados por vencimiento,
-- para poder reabrir si el pago llega tarde). Nulo si algún asiento no tiene tarifa.
create or replace function public.pay_total(p_code text) returns numeric language sql stable security definer set search_path = public as
$$
  select case when count(*) = 0 or bool_or(fare is null) then null else sum(fare) end
    from reservations where code = p_code and (status <> 'cancelada' or released_at is not null);
$$;

-- Datos de una reserva para armar el pago. Nulo si no existe.
create or replace function public.pay_context(p_code text) returns jsonb language plpgsql stable security definer set search_path = public as
$$
declare v jsonb;
begin
  select jsonb_build_object(
      'code', p_code,
      'live', count(*) filter (where status <> 'cancelada'),
      'pending', count(*) filter (where status = 'pendiente'),
      'confirmed', count(*) filter (where status = 'confirmada'),
      'seats', count(*) filter (where status <> 'cancelada'),
      'total', public.pay_total(p_code),
      'paid', coalesce((select sum(case kind when 'cobro' then amount else -amount end) from payments where code = p_code), 0),
      'expires', max(hold_expires_at) filter (where status = 'pendiente'),
      'name', min(passenger_name), 'doc', min(passenger_doc), 'phone', min(phone), 'email', min(email),
      'from', min(from_name), 'to', min(to_name), 'date', min(trip_date), 'time', min(trip_time))
    into v from reservations where code = p_code;
  if (v ->> 'live')::int = 0 and not exists (select 1 from reservations where code = p_code and released_at is not null) then return null; end if;
  return v;
end;
$$;

-- Estado público de una reserva para la web (sin datos personales): confirmada, pendiente, vencida, cancelada o inexistente.
create or replace function public.pay_public_status(p_code text) returns jsonb language plpgsql stable security definer set search_path = public as
$$
declare r record;
begin
  select count(*) as n, count(*) filter (where status = 'pendiente') as pend, count(*) filter (where status = 'confirmada') as conf,
         max(hold_expires_at) filter (where status = 'pendiente') as exp, count(*) filter (where released_at is not null) as rel
    into r from reservations where code = p_code;
  if r.n = 0 then return jsonb_build_object('state', 'inexistente'); end if;
  if r.pend > 0 then
    return jsonb_build_object('state', case when r.exp is not null and r.exp <= now() then 'vencida' else 'pendiente' end, 'expires', r.exp);
  end if;
  if r.conf > 0 then return jsonb_build_object('state', 'confirmada'); end if;
  return jsonb_build_object('state', case when r.rel > 0 then 'vencida' else 'cancelada' end);
end;
$$;

-- Guarda la orden de pago (link o CVU) de una reserva. Si ya existe la misma, la actualiza.
create or replace function public.pay_order_save(p_code text, p_provider text, p_ref text, p_amount numeric, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public as
$$
declare v payment_orders;
begin
  insert into payment_orders(code, provider, provider_ref, amount, data) values (p_code, p_provider, p_ref, p_amount, coalesce(p_data, '{}'::jsonb))
  on conflict (provider, provider_ref) do update set data = excluded.data, updated_at = now()
  returning * into v;
  return to_jsonb(v);
end;
$$;

-- La orden vigente (pendiente) de una reserva con un proveedor: se reutiliza en vez de crear otra.
create or replace function public.pay_order_open(p_code text, p_provider text) returns jsonb language sql stable security definer set search_path = public as
$$
  select to_jsonb(o) from payment_orders o where o.code = p_code and o.provider = p_provider and o.state = 'pendiente' order by o.created_at desc limit 1;
$$;

-- Busca una orden por su número en el proveedor.
create or replace function public.pay_order_find(p_provider text, p_ref text) returns jsonb language sql stable security definer set search_path = public as
$$
  select to_jsonb(o) from payment_orders o where o.provider = p_provider and o.provider_ref = p_ref;
$$;

create or replace function public.pay_order_state(p_provider text, p_ref text, p_state text) returns void language sql security definer set search_path = public as
$$
  update payment_orders set state = p_state, updated_at = now() where provider = p_provider and provider_ref = p_ref and state <> 'pagada';
$$;

-- Registra un cobro o una devolución que informó el proveedor. Es idempotente: el mismo (proveedor, número) no se repite.
-- Si con este cobro la reserva queda paga, la confirma; si se había liberado por vencimiento, intenta reabrirla.
-- Si el asiento ya se vendió a otra persona, no se reabre: queda cancelada con plata cobrada ("a devolver" en el ERP).
create or replace function public.pay_register(p_code text, p_provider text, p_ref text, p_kind text, p_amount numeric, p_method text, p_note text, p_confirm boolean default true) returns jsonb
language plpgsql security definer set search_path = public as
$$
declare
  v_id uuid; v_total numeric; v_paid numeric; v_confirmed boolean := false; v_reopened boolean := false; v_refund boolean := false;
begin
  if p_kind not in ('cobro', 'devolucion') or p_amount is null or p_amount <= 0 then return jsonb_build_object('ok', false, 'reason', 'monto'); end if;
  if not exists (select 1 from reservations where code = p_code) then return jsonb_build_object('ok', false, 'reason', 'sin_reserva'); end if;

  insert into payments(code, kind, amount, method, paid_at, ref, note, provider, provider_ref)
  values (p_code, p_kind, p_amount, p_method, (now() at time zone 'America/Argentina/Jujuy')::date, coalesce(p_ref, ''), coalesce(p_note, ''), p_provider, p_ref)
  on conflict (provider, provider_ref) where provider_ref is not null do nothing
  returning id into v_id;
  if v_id is null then return jsonb_build_object('ok', true, 'inserted', false); end if;

  v_total := public.pay_total(p_code);
  select coalesce(sum(case kind when 'cobro' then amount else -amount end), 0) into v_paid from payments where code = p_code;

  if p_confirm and p_kind = 'cobro' and v_total is not null and v_paid >= v_total then
    update reservations set status = 'confirmada', hold_expires_at = null where code = p_code and status = 'pendiente';
    v_confirmed := found;
    if not v_confirmed and exists (select 1 from reservations where code = p_code and status = 'cancelada' and released_at is not null)
       and not exists (select 1 from reservations where code = p_code and status <> 'cancelada') then
      begin
        update reservations set status = 'confirmada', hold_expires_at = null, released_at = null where code = p_code and status = 'cancelada' and released_at is not null;
        v_reopened := found; v_confirmed := v_reopened;
      exception when exclusion_violation then
        v_refund := true;  -- el asiento ya lo tomó otra reserva: no se reabre y hay que devolver
      end;
    end if;
    update payment_orders set state = 'pagada', updated_at = now() where code = p_code and provider = p_provider and state in ('pendiente', 'revision');
  end if;

  return jsonb_build_object('ok', true, 'inserted', true, 'confirmed', v_confirmed, 'reopened', v_reopened, 'needs_refund', v_refund, 'paid', v_paid, 'total', v_total);
end;
$$;

-- Devoluciones de un pago de Mercado Pago: deja registrado lo devuelto hasta ahora (total acumulado) sin duplicar.
create or replace function public.pay_sync_refund(p_code text, p_provider text, p_base_ref text, p_refunded numeric, p_method text) returns jsonb
language plpgsql security definer set search_path = public as
$$
declare v_have numeric; v_prefix text := p_base_ref || ':refund:'; v_diff numeric; v_id uuid;
begin
  if p_refunded is null or p_refunded <= 0 then return jsonb_build_object('ok', true, 'inserted', false); end if;
  select coalesce(sum(amount), 0) into v_have from payments
   where code = p_code and provider = p_provider and kind = 'devolucion' and left(provider_ref, length(v_prefix)) = v_prefix;
  v_diff := p_refunded - v_have;
  if v_diff <= 0 then return jsonb_build_object('ok', true, 'inserted', false); end if;
  insert into payments(code, kind, amount, method, paid_at, ref, note, provider, provider_ref)
  values (p_code, 'devolucion', v_diff, p_method, (now() at time zone 'America/Argentina/Jujuy')::date, p_base_ref, 'Devolución informada por el proveedor', p_provider, v_prefix || p_refunded::text)
  on conflict (provider, provider_ref) where provider_ref is not null do nothing returning id into v_id;
  return jsonb_build_object('ok', true, 'inserted', v_id is not null, 'amount', v_diff);
end;
$$;

create or replace function public.pay_log(p_provider text, p_kind text, p_ref text, p_ok boolean, p_detail text, p_payload jsonb) returns void
language sql security definer set search_path = public as
$$
  insert into payment_events(provider, kind, ref, ok, detail, payload) values (p_provider, p_kind, coalesce(p_ref, ''), p_ok, coalesce(p_detail, ''), p_payload);
$$;

-- 5) PERMISOS: las funciones del servidor no las puede ejecutar nadie desde el navegador.
revoke all on function public.pay_total(text), public.pay_context(text), public.pay_order_save(text, text, text, numeric, jsonb), public.pay_order_open(text, text),
  public.pay_order_find(text, text), public.pay_order_state(text, text, text),
  public.pay_register(text, text, text, text, numeric, text, text, boolean), public.pay_sync_refund(text, text, text, numeric, text),
  public.pay_log(text, text, text, boolean, text, jsonb) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.pay_total(text), public.pay_context(text), public.pay_order_save(text, text, text, numeric, jsonb), public.pay_order_open(text, text),
      public.pay_order_find(text, text), public.pay_order_state(text, text, text),
      public.pay_register(text, text, text, text, numeric, text, text, boolean), public.pay_sync_refund(text, text, text, numeric, text),
      public.pay_log(text, text, text, boolean, text, jsonb), public.pay_public_status(text) to service_role;
  end if;
end
$$;
-- el estado público (confirmada / pendiente / vencida) sí lo puede consultar la web: no devuelve datos personales
grant execute on function public.pay_public_status(text) to anon, authenticated;
