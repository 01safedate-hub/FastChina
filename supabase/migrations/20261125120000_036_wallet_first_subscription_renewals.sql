-- Phase 6: wallet-first automatic subscription renewal with external checkout fallback.
-- Existing sellers are opted out until they explicitly enable automatic renewal.

alter table public.wallet_ledger
  drop constraint if exists wallet_ledger_reason_check;
alter table public.wallet_ledger
  add constraint wallet_ledger_reason_check
  check (reason = any (array[
    'plan_cancelled','group_refund','order_refund','draw_win','spend',
    'topup','adjustment','customisation','subscription_renewal'
  ]::text[]);

create table if not exists public.store_subscription_settings (
  store_id uuid primary key references public.stores(id) on delete cascade,
  auto_renew boolean not null default false,
  renewal_status text not null default 'manual'
    check (renewal_status in ('manual','wallet_ready','external_required','renewed')),
  updated_at timestamptz not null default now()
);
alter table public.store_subscription_settings enable row level security;
revoke all on public.store_subscription_settings from anon, authenticated;
grant all on public.store_subscription_settings to service_role;

create table if not exists public.subscription_renewal_attempts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  period_due_at timestamptz not null,
  amount_ngn bigint not null check (amount_ngn > 0),
  status text not null check (status in ('wallet_paid','external_required')),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (store_id, period_due_at)
);
alter table public.subscription_renewal_attempts enable row level security;
revoke all on public.subscription_renewal_attempts from anon, authenticated;
grant all on public.subscription_renewal_attempts to service_role;

create or replace function public.my_subscription_renewal_settings()
returns table (
  auto_renew boolean,
  renewal_status text,
  wallet_ngn bigint,
  plan_renews_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(ss.auto_renew, false),
         coalesce(ss.renewal_status, 'manual'),
         coalesce((select sum(w.amount_ngn)::bigint from public.wallet_ledger w where w.customer_id = auth.uid()), 0),
         s.plan_renews_at
  from public.stores s
  left join public.store_subscription_settings ss on ss.store_id = s.id
  where s.owner_id = auth.uid()
  limit 1
$$;

create or replace function public.set_my_subscription_auto_renew(p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_store public.stores;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  select * into v_store from public.stores where owner_id = auth.uid() for update;
  if v_store.id is null then raise exception 'Open a store first'; end if;
  if p_enabled and v_store.plan = 'free' then
    raise exception 'Automatic renewal is available for paid plans only';
  end if;
  insert into public.store_subscription_settings(store_id, auto_renew, renewal_status, updated_at)
  values (v_store.id, p_enabled, case when p_enabled then 'wallet_ready' else 'manual' end, now())
  on conflict (store_id) do update
    set auto_renew = excluded.auto_renew,
        renewal_status = case when excluded.auto_renew then 'wallet_ready' else 'manual' end,
        updated_at = now();
  return true;
end
$$;

create or replace function public.process_due_store_subscription_renewals()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  st record;
  v_wallet bigint;
  v_price bigint;
  v_attempt uuid;
  v_count integer := 0;
begin
  if current_user not in ('postgres','service_role','supabase_admin') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  for st in
    select s.id, s.owner_id, s.plan, s.plan_renews_at
    from public.stores s
    join public.store_subscription_settings ss on ss.store_id = s.id
    where ss.auto_renew = true
      and s.plan in ('pro','elite')
      and s.status <> 'suspended'
      and s.plan_renews_at is not null
      and s.plan_renews_at <= now()
    order by s.plan_renews_at
    for update of s skip locked
  loop
    select pr.price_ngn::bigint into v_price
    from public.plan_rules(st.plan) pr;
    if coalesce(v_price, 0) <= 0 then continue; end if;

    insert into public.subscription_renewal_attempts(store_id, period_due_at, amount_ngn, status)
    values (st.id, st.plan_renews_at, v_price, 'external_required')
    on conflict (store_id, period_due_at) do nothing
    returning id into v_attempt;
    if v_attempt is null then continue; end if;

    select coalesce(sum(w.amount_ngn)::bigint, 0) into v_wallet
    from public.wallet_ledger w
    where w.customer_id = st.owner_id;

    if v_wallet >= v_price then
      insert into public.wallet_ledger(customer_id, amount_ngn, reason, ref_id)
      values (st.owner_id, -v_price::integer, 'subscription_renewal', v_attempt);
      perform public.set_store_plan(st.id, st.plan, 1);
      update public.subscription_renewal_attempts
        set status = 'wallet_paid', completed_at = now()
        where id = v_attempt;
      update public.store_subscription_settings
        set renewal_status = 'renewed', updated_at = now()
        where store_id = st.id;
    else
      update public.store_subscription_settings
        set renewal_status = 'external_required', updated_at = now()
        where store_id = st.id;
      perform public.notify(
        st.owner_id,
        'billing',
        'Subscription renewal needs payment',
        'Your wallet balance is not enough to renew your ' || upper(st.plan) ||
          ' plan. Complete an external payment from Manage subscription to keep your store active.',
        '/store/seller/plan',
        'subscription_renewal_wallet_low',
        jsonb_build_object('plan', st.plan, 'amount_ngn', v_price, 'wallet_ngn', v_wallet),
        'subscription-renewal:' || v_attempt::text,
        false,
        null
      );
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end
$$;

revoke all on function public.my_subscription_renewal_settings() from public, anon;
grant execute on function public.my_subscription_renewal_settings() to authenticated;
revoke all on function public.set_my_subscription_auto_renew(boolean) from public, anon;
grant execute on function public.set_my_subscription_auto_renew(boolean) to authenticated;
revoke all on function public.process_due_store_subscription_renewals() from public, anon, authenticated;
grant execute on function public.process_due_store_subscription_renewals() to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'seller-subscription-wallet-renewals') then
    perform cron.unschedule('seller-subscription-wallet-renewals');
  end if;
  perform cron.schedule(
    'seller-subscription-wallet-renewals',
    '*/5 * * * *',
    'select public.process_due_store_subscription_renewals()'
  );
end
$$;
