-- Phase 5: seller refund adjustments and payout reconciliation.
-- All changes are transactional. No automatic bank clawback is performed.

create table if not exists public.seller_payout_adjustments (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  order_item_id uuid not null unique references public.order_items(id),
  original_payout_id uuid not null references public.seller_payouts(id),
  amount_ngn integer not null check (amount_ngn > 0),
  reason text not null default 'order_refund',
  created_at timestamptz not null default now()
);

create table if not exists public.seller_payout_adjustment_applications (
  id uuid primary key default gen_random_uuid(),
  adjustment_id uuid not null references public.seller_payout_adjustments(id),
  payout_id uuid not null references public.seller_payouts(id),
  amount_ngn integer not null check (amount_ngn > 0),
  created_at timestamptz not null default now(),
  unique (adjustment_id, payout_id)
);

create index if not exists seller_payout_adjustments_store_created_idx
  on public.seller_payout_adjustments(store_id, created_at);
create index if not exists seller_payout_adjustment_applications_payout_idx
  on public.seller_payout_adjustment_applications(payout_id);

alter table public.seller_payout_adjustments enable row level security;
alter table public.seller_payout_adjustment_applications enable row level security;

drop policy if exists "Seller reads own payout adjustments" on public.seller_payout_adjustments;
create policy "Seller reads own payout adjustments"
on public.seller_payout_adjustments for select to authenticated
using (
  exists (select 1 from public.stores s where s.id = store_id and s.owner_id = (select auth.uid()))
  or (select public.is_staff())
);

drop policy if exists "Seller reads own payout adjustment applications" on public.seller_payout_adjustment_applications;
create policy "Seller reads own payout adjustment applications"
on public.seller_payout_adjustment_applications for select to authenticated
using (
  exists (
    select 1 from public.seller_payout_adjustments a
    join public.stores s on s.id = a.store_id
    where a.id = adjustment_id and (s.owner_id = (select auth.uid()) or (select public.is_staff()))
  )
);

grant select on public.seller_payout_adjustments, public.seller_payout_adjustment_applications to authenticated;
revoke insert, update, delete on public.seller_payout_adjustments, public.seller_payout_adjustment_applications from anon, authenticated;

-- Reconcile the payout references affected by a refund. Called inside cancel_or_refund's transaction.
create or replace function public.reconcile_seller_refund(p_order uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  p record;
  v_amount bigint;
  v_items integer;
  v_net integer;
begin
  for p in
    select distinct sp.id, sp.status
    from public.order_items i
    join public.seller_payouts sp on sp.id = i.payout_id
    where i.order_id = p_order
    order by sp.id
    for update of sp
  loop
    if p.status = 'paid' then
      -- Preserve the historical payout; record a debit against future seller earnings.
      insert into public.seller_payout_adjustments
        (store_id, order_item_id, original_payout_id, amount_ngn, reason)
      select e.store_id, e.item_id, p.id, e.net_ngn, 'order_refund'
      from public.store_earnings_all e
      where e.order_id = p_order
        and e.item_id in (select i.id from public.order_items i where i.order_id = p_order and i.payout_id = p.id)
        and e.net_ngn > 0
      on conflict (order_item_id) do nothing;
    else
      -- Failed or pending transfers were not settled: release every item in the batch.
      if p.status = 'pending' then
        update public.order_items set payout_id = null where order_id = p_order and payout_id = p.id;
        select coalesce(sum(e.net_ngn), 0), count(*)::integer
          into v_amount, v_items
        from public.store_earnings_all e
        join public.order_items i on i.id = e.item_id
        where i.payout_id = p.id and e.bucket = 'paid_out';

        if v_amount >= 1000 and v_items > 0 then
          update public.seller_payouts set amount_ngn = v_amount::integer, items = v_items where id = p.id and status = 'pending';
        else
          update public.order_items set payout_id = null where payout_id = p.id;
          update public.seller_payouts set status = 'failed' where id = p.id and status = 'pending';
        end if;
      else
        update public.order_items set payout_id = null where payout_id = p.id;
      end if;
    end if;
  end loop;
end $$;

revoke execute on function public.reconcile_seller_refund(uuid) from public, anon, authenticated;
grant execute on function public.reconcile_seller_refund(uuid) to service_role;

-- Replace the cancellation routine so refund reconciliation commits or rolls back with the refund.
create or replace function public.cancel_or_refund(p_order uuid, p_note text)
returns text
language plpgsql security definer set search_path = '' as $function$
declare o public.orders; target text;
begin
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'Unknown order'; end if;
  if o.pay_mode = 'group' and o.paid_ngn > 0 and o.paid_ngn < o.total_ngn then
    raise exception 'Order % has Group pay contributions. It can''t be cancelled until it''s fully paid.', o.code using errcode = 'check_violation';
  end if;
  target := case when o.status = 'shipped' then 'refunded' else 'cancelled' end;
  if not public.order_can_move(o.status, target) then
    raise exception 'Order % is % and can''t be %', o.code, o.status, target using errcode = 'check_violation';
  end if;
  perform set_config('fastchina.note', coalesce(nullif(trim(p_note), ''), 'by staff'), true);
  update public.orders set status = target where id = o.id;
  perform public.reconcile_seller_refund(o.id);
  if o.paid_ngn > 0 then
    if o.customer_id is not null then
      insert into public.wallet_ledger (customer_id, amount_ngn, reason, ref_id) values (o.customer_id, o.paid_ngn, 'order_refund', o.id);
    else
      insert into public.refunds_due (source, ref_id, amount_ngn) values ('order', o.id, o.paid_ngn);
    end if;
  end if;
  update public.payment_plans set status = 'cancelled' where order_id = o.id and status = 'active';
  return target;
end $function$;

-- Weekly payout generation applies outstanding refund debits before creating a bank batch.
-- A minimum net batch of ₦1,000 is retained; unapplied adjustment balances carry forward.
create or replace function public.create_weekly_payouts() returns int
language plpgsql security definer set search_path = '' as $$
declare
  s record;
  v_item record;
  v_adj record;
  v_ids uuid[];
  v_gross bigint;
  v_due bigint;
  v_apply bigint;
  v_left bigint;
  v_count int;
  v_net bigint;
  v_payout uuid;
  v_locked int;
  n int := 0;
begin
  for s in
    select id, bank_name, account_number, account_name
    from public.stores
    where account_number is not null and status <> 'suspended'
    order by id
    for update
  loop
    v_ids := array[]::uuid[];
    v_gross := 0;
    v_count := 0;

    for v_item in
      select i.id, e.net_ngn
      from public.order_items i
      join public.store_earnings_all e on e.item_id = i.id
      where e.store_id = s.id and e.bucket = 'available' and i.payout_id is null
      order by i.id
      for update of i skip locked
    loop
      v_ids := array_append(v_ids, v_item.id);
      v_gross := v_gross + v_item.net_ngn;
      v_count := v_count + 1;
    end loop;

    if v_count = 0 or v_gross < 1000 then continue; end if;

    select coalesce(sum(a.amount_ngn - coalesce(x.applied_ngn, 0)), 0)
      into v_due
    from public.seller_payout_adjustments a
    left join lateral (
      select sum(ap.amount_ngn)::bigint as applied_ngn
      from public.seller_payout_adjustment_applications ap
      where ap.adjustment_id = a.id
    ) x on true
    where a.store_id = s.id;

    -- Do not create a negative or sub-minimum transfer. Carry the remainder forward.
    v_apply := least(v_due, greatest(v_gross - 999, 0));
    if v_gross - v_apply < 1000 then continue; end if;

    insert into public.seller_payouts (store_id, amount_ngn, items, bank_snapshot)
    values (
      s.id,
      (v_gross - v_apply)::integer,
      v_count,
      jsonb_build_object('bank', s.bank_name, 'account', s.account_number, 'name', s.account_name)
    )
    returning id into v_payout;

    update public.order_items set payout_id = v_payout
    where id = any(v_ids) and payout_id is null;
    get diagnostics v_locked = row_count;
    if v_locked <> v_count then
      raise exception 'Payout item assignment changed during generation; transaction rolled back';
    end if;

    -- Apply the offset with immutable application rows; remaining balances stay outstanding.
    v_left := v_apply;
    for v_adj in
      select a.id, a.amount_ngn - coalesce((
        select sum(ap.amount_ngn) from public.seller_payout_adjustment_applications ap where ap.adjustment_id = a.id
      ), 0) as outstanding
      from public.seller_payout_adjustments a
      where a.store_id = s.id
        and a.amount_ngn > coalesce((select sum(ap.amount_ngn) from public.seller_payout_adjustment_applications ap where ap.adjustment_id = a.id), 0)
      order by a.created_at, a.id
      for update of a
    loop
      exit when v_left <= 0;
      v_net := least(v_left, v_adj.outstanding);
      insert into public.seller_payout_adjustment_applications (adjustment_id, payout_id, amount_ngn)
      values (v_adj.id, v_payout, v_net::integer)
      on conflict (adjustment_id, payout_id) do nothing;
      v_left := v_left - v_net;
    end loop;

    n := n + 1;
  end loop;
  return n;
end $$;

revoke execute on function public.create_weekly_payouts() from public, anon, authenticated;
grant execute on function public.create_weekly_payouts() to service_role;

-- Staff may only mark a batch paid if its item-backed amount still reconciles exactly.
create or replace function public.mark_seller_payout_paid(p_payout uuid, p_reference text)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  p public.seller_payouts;
  v_amount bigint;
  v_count integer;
begin
  if nullif(trim(p_reference), '') is null then raise exception 'Transfer reference required'; end if;
  select * into p from public.seller_payouts where id = p_payout for update;
  if p.id is null or p.status <> 'pending' then return false; end if;

  select coalesce(sum(e.net_ngn), 0), count(*)::integer
    into v_amount, v_count
  from public.store_earnings_all e
  join public.order_items i on i.id = e.item_id
  where i.payout_id = p.id and e.bucket = 'paid_out';

  if v_count <> p.items or v_amount <> p.amount_ngn then
    raise exception 'Payout does not reconcile to eligible seller earnings; do not transfer it.' using errcode = 'check_violation';
  end if;

  update public.seller_payouts
  set status = 'paid', reference = left(trim(p_reference), 80), paid_at = now()
  where id = p.id and status = 'pending';
  return found;
end $$;

revoke execute on function public.mark_seller_payout_paid(uuid, text) from public, anon, authenticated;
grant execute on function public.mark_seller_payout_paid(uuid, text) to service_role;
