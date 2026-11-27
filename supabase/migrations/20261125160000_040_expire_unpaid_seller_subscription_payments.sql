-- Expire unpaid seller subscription checkouts after 24 hours.
alter table public.payment_transactions
  add column if not exists expires_at timestamptz;

update public.payment_transactions
set expires_at = created_at + interval '24 hours'
where purpose = 'seller_subscription'
  and expires_at is null;

create index if not exists payment_transactions_pending_subscription_expiry_idx
  on public.payment_transactions (expires_at)
  where purpose = 'seller_subscription' and status = 'pending';

create or replace function public.expire_pending_seller_subscription_payments()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if current_user not in ('postgres','service_role','supabase_admin') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  update public.payment_transactions
  set status = 'cancelled',
      updated_at = now(),
      provider_payload = coalesce(provider_payload, '{}'::jsonb) ||
        jsonb_build_object(
          'system_cancellation', jsonb_build_object(
            'reason', 'checkout_expired',
            'expired_at', now(),
            'message', 'Seller subscription checkout was not completed within 24 hours.'
          )
        )
  where purpose = 'seller_subscription'
    and status = 'pending'
    and coalesce(expires_at, created_at + interval '24 hours') <= now();

  get diagnostics v_count = row_count;
  return v_count;
end
$$;

revoke all on function public.expire_pending_seller_subscription_payments() from public, anon, authenticated;
grant execute on function public.expire_pending_seller_subscription_payments() to service_role;

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
declare
  payment public.payment_transactions;
  remaining bigint;
  link_code text;
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

  -- A late provider callback must never activate a subscription after its 24-hour checkout window.
  if payment.purpose = 'seller_subscription'
    and payment.status = 'pending'
    and coalesce(payment.expires_at, payment.created_at + interval '24 hours') <= now() then
    update public.payment_transactions
      set status = 'cancelled',
          updated_at = now(),
          provider_payload = coalesce(provider_payload, '{}'::jsonb) ||
            jsonb_build_object(
              'system_cancellation', jsonb_build_object(
                'reason', 'checkout_expired',
                'expired_at', now(),
                'message', 'Seller subscription checkout was not completed within 24 hours.'
              )
            )
      where id = payment.id;
    return false;
  end if;

  -- Ignore duplicate callbacks for a transaction already cancelled by the expiry worker.
  if payment.status = 'cancelled' then return false; end if;
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
      set renewal_status = 'renewed', updated_at = now()
      where store_id = payment.store_id;
  end if;

  update public.payment_transactions set status='success',
    provider_transaction_id=p_provider_transaction_id,
    provider_payload=coalesce(p_payload,'{}'::jsonb), verified_at=now(), updated_at=now()
    where id=payment.id;
  return true;
end
$$;

revoke all on function public.record_verified_payment(text,text,text,bigint,text,jsonb) from public, anon, authenticated;
grant execute on function public.record_verified_payment(text,text,text,bigint,text,jsonb) to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'seller-subscription-payment-expiry') then
    perform cron.unschedule('seller-subscription-payment-expiry');
  end if;
  perform cron.schedule(
    'seller-subscription-payment-expiry',
    '*/5 * * * *',
    'select public.expire_pending_seller_subscription_payments()'
  );
end
$$;
