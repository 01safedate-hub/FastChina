alter table public.store_subscription_settings
  drop constraint if exists store_subscription_settings_renewal_status_check;
alter table public.store_subscription_settings
  add constraint store_subscription_settings_renewal_status_check
  check (renewal_status in ('manual','wallet_ready','external_required','external_checkout_pending','renewed'));

create or replace function public.process_due_store_subscription_renewals()
returns integer language plpgsql security definer set search_path = ''
as $$
declare st record; v_wallet bigint; v_price bigint; v_attempt uuid; v_count integer := 0;
begin
  if current_user not in ('postgres','service_role','supabase_admin') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  for st in
    select s.id, s.owner_id, s.plan, s.plan_renews_at
    from public.stores s
    join public.store_subscription_settings ss on ss.store_id = s.id
    where ss.auto_renew = true
      and ss.renewal_status in ('wallet_ready','external_required')
      and s.plan in ('pro','elite') and s.status <> 'suspended'
      and s.plan_renews_at is not null and s.plan_renews_at <= now()
    order by s.plan_renews_at
    for update of s skip locked
  loop
    select pr.price_ngn::bigint into v_price from public.plan_rules(st.plan) pr;
    if coalesce(v_price, 0) <= 0 then continue; end if;
    insert into public.subscription_renewal_attempts(store_id, period_due_at, amount_ngn, status)
    values (st.id, st.plan_renews_at, v_price, 'external_required')
    on conflict (store_id, period_due_at) do update
      set amount_ngn = excluded.amount_ngn
      where public.subscription_renewal_attempts.status = 'external_required'
    returning id into v_attempt;
    if v_attempt is null then continue; end if;
    select coalesce(sum(w.amount_ngn)::bigint, 0) into v_wallet
      from public.wallet_ledger w where w.customer_id = st.owner_id;
    if v_wallet >= v_price then
      insert into public.wallet_ledger(customer_id, amount_ngn, reason, ref_id)
        values (st.owner_id, -v_price::integer, 'subscription_renewal', v_attempt);
      perform public.set_store_plan(st.id, st.plan, 1);
      update public.subscription_renewal_attempts
        set status = 'wallet_paid', completed_at = now() where id = v_attempt;
      update public.store_subscription_settings
        set renewal_status = 'renewed', updated_at = now() where store_id = st.id;
    else
      update public.store_subscription_settings
        set renewal_status = 'external_required', updated_at = now() where store_id = st.id;
      perform public.notify(
        st.owner_id, 'billing', 'Subscription renewal needs payment',
        'Your wallet balance is not enough to renew your ' || upper(st.plan) ||
          ' plan. Complete an external payment from Manage subscription to keep your store active.',
        '/store/seller/plan', null,
        jsonb_build_object('plan', st.plan, 'amount_ngn', v_price, 'wallet_ngn', v_wallet),
        'subscription-renewal:' || v_attempt::text, false, null
      );
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end
$$;