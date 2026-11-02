-- =====================================================================================
--  PANAMERICANO · ERP: cobros y gastos (se suman a las reservas que ya existen)
--  Pegar TODO este archivo en: Supabase > SQL Editor > New query > Run.
--  Va DESPUÉS de schema.sql y booking.sql. Solo CREA cosas: no borra ni cambia nada de lo que ya hay,
--  y se puede volver a ejecutar sin problema.
-- =====================================================================================

-- 1) COBROS: cada pago (o devolución) de una reserva. Una reserva puede tener varios pagos (seña + saldo).
create table if not exists public.payments (
  id         uuid primary key default gen_random_uuid(),
  code       text not null,                                   -- código de la reserva (PB-XXXXXX)
  kind       text not null default 'cobro' check (kind in ('cobro', 'devolucion')),
  amount     numeric(12, 2) not null check (amount > 0),
  method     text not null default 'efectivo' check (method in ('efectivo', 'transferencia', 'mercadopago', 'tarjeta', 'otro')),
  paid_at    date not null default (now() at time zone 'America/Argentina/Jujuy')::date,
  ref        text not null default '',                        -- número de operación, comprobante, etc.
  note       text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists payments_code_idx on public.payments (code);
create index if not exists payments_fecha_idx on public.payments (paid_at);
alter table public.payments enable row level security;

-- 2) GASTOS: combustible, peajes, sueldos, mantenimiento, etc. Pueden asignarse a un coche y/o a un servicio.
create table if not exists public.expenses (
  id          uuid primary key default gen_random_uuid(),
  spent_at    date not null default (now() at time zone 'America/Argentina/Jujuy')::date,
  category    text not null default 'otros',
  amount      numeric(12, 2) not null check (amount > 0),
  description text not null default '',
  supplier    text not null default '',
  method      text not null default 'efectivo' check (method in ('efectivo', 'transferencia', 'mercadopago', 'tarjeta', 'otro')),
  bus_id      text,                                           -- coche (opcional)
  route_id    text,                                           -- servicio (opcional)
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists expenses_fecha_idx on public.expenses (spent_at);
alter table public.expenses enable row level security;

-- 3) PERMISOS: solo administradores. La web pública no ve nada de esto.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'payments' and policyname = 'admin maneja cobros') then
    create policy "admin maneja cobros" on public.payments for all to authenticated using (public.is_admin()) with check (public.is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'expenses' and policyname = 'admin maneja gastos') then
    create policy "admin maneja gastos" on public.expenses for all to authenticated using (public.is_admin()) with check (public.is_admin());
  end if;
end
$$;
