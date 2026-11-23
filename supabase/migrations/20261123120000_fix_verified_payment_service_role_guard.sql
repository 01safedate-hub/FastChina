create or replace function public.record_verified_payment(
  p_provider text,
  p_reference text,
  p_provider_transaction_id text,
  p_amount_ngn bigint,
  p_currency text,
  p_payload jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
declare
  payment public.payment_transactions;
  remaining bigint;
begin
  -- Execute permission is restricted to service_role. Check the active PostgREST
  -- database role rather than JWT claims: Supabase sb_secret_* keys do not expose
  -- request.jwt.claim.role, even when mapped to service_role.
  if coalesce(current_setting('role', true), '') <> 'service_role' then
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
$function$;

revoke all on function public.record_verified_payment(text,text,text,bigint,text,jsonb) from public, anon, authenticated;
grant execute on function public.record_verified_payment(text,text,text,bigint,text,jsonb) to service_role;
