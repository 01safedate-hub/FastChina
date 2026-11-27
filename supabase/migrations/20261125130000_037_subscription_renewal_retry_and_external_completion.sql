-- Retry external-required renewals after wallet top-ups and reconcile external payments.
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
    where ss.auto_renew = true and s.plan in ('pro','elite')
      and s.status <> 'suspended' and s.plan_renews_at is not null
      and s.plan_renews_at <= now()
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
        '/store/seller/plan', 'subscription_renewal_wallet_low',
        jsonb_build_object('plan', st.plan, 'amount_ngn', v_price, 'wallet_ngn', v_wallet),
        'subscription-renewal:' || v_attempt::text, false, null
      );
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end
$$;

create or replace function public.record_verified_payment(
  p_provider text, p_reference text, p_provider_transaction_id text,
  p_amount_ngn bigint, p_currency text, p_payload jsonb default '{}'::jsonb
) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare payment public.payment_transactions; remaining bigint; link_code text;
begin
  if coalesce(current_setting('role', true), '') <> 'service_role' then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p_provider not in ('paystack','flutterwave') or p_currency <> 'NGN' or p_amount_ngn <= 0 then
    raise exception 'Invalid verified payment details' using errcode = 'check_violation';
  end if;
  select * into payment from public.payment_transactions
    where provider = p_provider and reference = p_reference for update;
  if payment.id is null then raise exception 'Unknown payment reference' using errcode = 'no_data_found'; end if;
  if payment.status = 'success' then return false; end if;
  if payment.status <> 'pending' then raise exception 'Payment is not pending' using errcode = 'check_violation'; end if;
  if payment.amount_ngn <> p_amount_ngn then raise exception 'Payment amount mismatch' using errcode = 'check_violation'; end if;
  if payment.provider_transaction_id is not null and payment.provider_transaction_id <> p_provider_transaction_id then
    raise exception 'Provider transaction mismatch' using errcode = 'check_violation';
  end if;
  if payment.purpose = 'group_contribution' then
    select code into link_code from public.group_links where id = payment.group_link_id;
    if link_code is null then raise exception 'Group payment link not found' using errcode = 'check_violation'; end if;
    perform public.contribute(link_code, payment.amount_ngn::integer,
      coalesce(payment.contributor_name, 'A friend'), payment.customer_id, payment.reference);
  elsif payment.purpose = 'order' then
    select total_ngn - paid_ngn into remaining from public.orders where id = payment.order_id for update;
    if remaining is null or remaining < p_amount_ngn then
      raise exception 'Order balance is less than payment amount' using errcode = 'check_violation';
    end if;
    update public.orders set paid_ngn = paid_ngn + p_amount_ngn
      where id = payment.order_id and status in ('awaiting_payment','part_paid');
    if not found then raise exception 'Order cannot accept payment' using errcode = 'check_violation'; end if;
  else
    if payment.subscription_plan is null then raise exception 'Subscription plan missing' using errcode = 'check_violation'; end if;
    perform public.set_store_plan(payment.store_id, payment.subscription_plan, payment.subscription_months);
    update public.store_subscription_settings
      set renewal_status = 'renewed', updated_at = now() where store_id = payment.store_id;
  end if;
  update public.payment_transactions set status='success',
    provider_transaction_id=p_provider_transaction_id,
    provider_payload=coalesce(p_payload,'{}'::jsonb), verified_at=now()
    where id=payment.id;
  return true;
end
$$;
revoke all on function public.record_verified_payment(text,text,text,bigint,text,jsonb) from public, anon, authenticated;
grant execute on function public.record_verified_payment(text,text,text,bigint,text,jsonb) to service_role;
