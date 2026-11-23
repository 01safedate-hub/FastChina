-- Phase 5: make weekly seller payout generation safe to retry and concurrent runs.
-- This creates pending payout batches only. It does NOT initiate bank transfers or mark payouts paid.

create or replace function public.create_weekly_payouts() returns int
language plpgsql security definer set search_path = '' as $$
declare
  s record;
  v_item record;
  v_ids uuid[];
  v_net bigint;
  v_count int;
  v_payout uuid;
  v_locked int;
  n int := 0;
begin
  -- Lock stores in a stable order. A second run waits for the first run to finish
  -- before it can calculate eligible items for the same seller.
  for s in
    select id, bank_name, account_number, account_name
    from public.stores
    where account_number is not null and status <> 'suspended'
    order by id
    for update
  loop
    v_ids := array[]::uuid[];
    v_net := 0;
    v_count := 0;

    -- Lock each eligible earning row. payout_id IS NULL is the durable idempotency
    -- marker: once attached to a payout, an item can never be batched again.
    for v_item in
      select i.id, e.net_ngn
      from public.order_items i
      join public.store_earnings_all e on e.item_id = i.id
      where e.store_id = s.id
        and e.bucket = 'available'
        and i.payout_id is null
      order by i.id
      for update of i skip locked
    loop
      v_ids := array_append(v_ids, v_item.id);
      v_net := v_net + v_item.net_ngn;
      v_count := v_count + 1;
    end loop;

    if v_count = 0 or v_net < 1000 then
      continue;
    end if;

    insert into public.seller_payouts (store_id, amount_ngn, items, bank_snapshot)
    values (
      s.id,
      v_net::int,
      v_count,
      jsonb_build_object('bank', s.bank_name, 'account', s.account_number, 'name', s.account_name)
    )
    returning id into v_payout;

    update public.order_items
    set payout_id = v_payout
    where id = any(v_ids) and payout_id is null;
    get diagnostics v_locked = row_count;

    if v_locked <> v_count then
      raise exception 'Payout item assignment changed during generation; transaction rolled back';
    end if;

    n := n + 1;
  end loop;
  return n;
end $$;

revoke execute on function public.create_weekly_payouts() from public, anon, authenticated;
grant execute on function public.create_weekly_payouts() to service_role;
