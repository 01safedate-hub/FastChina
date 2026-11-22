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
