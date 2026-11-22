-- 032: provider-neutral payment ledger for retail orders and seller subscriptions.
-- Payment records are server-managed only. Never grant browser roles direct write access.

create table public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('paystack', 'flutterwave')),
  purpose text not null check (purpose in ('order', 'seller_subscription')),
  reference text not null unique,
  provider_transaction_id text,
  order_id uuid references public.orders(id) on delete restrict,
  store_id uuid references public.stores(id) on delete restrict,
  customer_id uuid references auth.users(id) on delete set null,
  amount_ngn bigint not null check (amount_ngn > 0),
  currency text not null default 'NGN' check (currency = 'NGN'),
  status text not null default 'pending' check (status in ('pending', 'success', 'failed', 'cancelled', 'reversed')),
  checkout_url text,
  provider_payload jsonb,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_transaction_target_check check (
    (purpose = 'order' and order_id is not null and store_id is null)
    or (purpose = 'seller_subscription' and store_id is not null and order_id is null)
  )
);
create unique index payment_transactions_provider_id_idx
  on public.payment_transactions(provider, provider_transaction_id)
  where provider_transaction_id is not null;
create index payment_transactions_order_idx on public.payment_transactions(order_id, created_at desc);
create index payment_transactions_store_idx on public.payment_transactions(store_id, created_at desc);
alter table public.payment_transactions enable row level security;
revoke all on public.payment_transactions from anon, authenticated;
grant all on public.payment_transactions to service_role;

create table public.payment_webhook_events (
  id bigint generated always as identity primary key,
  provider text not null check (provider in ('paystack', 'flutterwave')),
  event_id text not null,
  event_type text not null,
  reference text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_error text,
  payload jsonb not null default '{}'::jsonb,
  unique(provider, event_id)
);
alter table public.payment_webhook_events enable row level security;
revoke all on public.payment_webhook_events from anon, authenticated;
grant all on public.payment_webhook_events to service_role;

create or replace function public.touch_payment_transaction()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger payment_transactions_touch
before update on public.payment_transactions
for each row execute function public.touch_payment_transaction();

alter table public.payment_transactions
  add column subscription_plan text check (subscription_plan in ('pro', 'elite')),
  add column subscription_months int not null default 1 check (subscription_months between 1 and 12);

create or replace function public.record_verified_payment(
  p_provider text,
  p_reference text,
  p_provider_transaction_id text,
  p_amount_ngn bigint,
  p_currency text,
  p_payload jsonb default '{}'::jsonb
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare payment public.payment_transactions;
declare remaining bigint;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p_provider not in ('paystack', 'flutterwave') or p_currency <> 'NGN' or p_amount_ngn <= 0 then
    raise exception 'Invalid verified payment details' using errcode = 'check_violation';
  end if;

  select * into payment
  from public.payment_transactions
  where provider = p_provider and reference = p_reference
  for update;

  if payment.id is null then raise exception 'Unknown payment reference' using errcode = 'no_data_found'; end if;
  if payment.status = 'success' then return false; end if;
  if payment.status <> 'pending' then raise exception 'Payment is not pending' using errcode = 'check_violation'; end if;
  if payment.amount_ngn <> p_amount_ngn then raise exception 'Payment amount mismatch' using errcode = 'check_violation'; end if;
  if payment.provider_transaction_id is not null and payment.provider_transaction_id <> p_provider_transaction_id then
    raise exception 'Provider transaction mismatch' using errcode = 'check_violation';
  end if;

  update public.payment_transactions
  set status = 'success', provider_transaction_id = p_provider_transaction_id,
      provider_payload = coalesce(p_payload, '{}'::jsonb), verified_at = now()
  where id = payment.id;

  if payment.purpose = 'order' then
    select total_ngn - paid_ngn into remaining
    from public.orders where id = payment.order_id for update;
    if remaining is null or remaining < p_amount_ngn then
      raise exception 'Order balance is less than payment amount' using errcode = 'check_violation';
    end if;
    update public.orders
    set paid_ngn = paid_ngn + p_amount_ngn
    where id = payment.order_id and status in ('awaiting_payment', 'part_paid');
    if not found then raise exception 'Order cannot accept payment' using errcode = 'check_violation'; end if;
  else
    if payment.subscription_plan is null then raise exception 'Subscription plan missing' using errcode = 'check_violation'; end if;
    perform public.set_store_plan(payment.store_id, payment.subscription_plan, payment.subscription_months);
  end if;

  return true;
end
$$;

revoke all on function public.record_verified_payment(text, text, text, bigint, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_verified_payment(text, text, text, bigint, text, jsonb) to service_role;
