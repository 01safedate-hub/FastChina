-- Phase 5 follow-up: lock payout bank details to the server and harden terminal provider states.
-- Bank details are written only by the seller-payouts Edge Function after Paystack resolution.
revoke update (account_name, account_number, bank_name, payout_bank_code,
               payout_account_verified_at, paystack_recipient_code)
  on table public.stores from anon, authenticated;

-- A delayed provider event must not undo a failed transfer or a reversal.
create or replace function public.record_paystack_seller_payout_event(
  p_reference text,
  p_status text,
  p_amount_kobo bigint,
  p_currency text,
  p_payload jsonb
) returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  p public.seller_payouts;
begin
  if p_status is null or p_status not in ('success','failed','reversed') then
    raise exception 'Unsupported Paystack payout status';
  end if;

  select * into p
  from public.seller_payouts
  where transfer_reference = p_reference
  for update;

  if p.id is null then
    return false;
  end if;

  if p_amount_kobo is null
     or p_amount_kobo <> p.amount_ngn::bigint * 100
     or p_currency is distinct from 'NGN' then
    raise exception 'Paystack payout amount or currency mismatch';
  end if;

  -- Reversals are terminal for automated processing and always require staff review.
  if p.transfer_status = 'reversed' then
    return true;
  end if;

  -- A final failure cannot be converted into success by a stale event.
  if p.transfer_status = 'failed' then
    return true;
  end if;

  -- Successful transfers stay paid unless Paystack later reports a reversal.
  if p.transfer_status = 'success' and p_status <> 'reversed' then
    return true;
  end if;

  if p_status = 'success' then
    update public.seller_payouts
    set status = 'paid',
        transfer_status = 'success',
        reference = p_reference,
        paid_at = coalesce(paid_at, now()),
        transfer_payload = coalesce(p_payload, '{}'::jsonb),
        transfer_updated_at = now()
    where id = p.id;

  elsif p_status = 'failed' then
    update public.seller_payouts
    set status = 'failed',
        transfer_status = 'failed',
        transfer_payload = coalesce(p_payload, '{}'::jsonb),
        transfer_updated_at = now()
    where id = p.id;

    delete from public.seller_payout_adjustment_applications
    where payout_id = p.id;

    delete from public.seller_payout_adjustments
    where original_payout_id = p.id;

    update public.order_items
    set payout_id = null
    where payout_id = p.id;

  elsif p_status = 'reversed' then
    -- A reversal after a successful credit may mean the seller was already credited.
    -- Preserve the historical transfer and require staff reconciliation.
    update public.seller_payouts
    set status = 'needs_review',
        transfer_status = 'reversed',
        transfer_payload = coalesce(p_payload, '{}'::jsonb),
        transfer_updated_at = now()
    where id = p.id;
  end if;

  return true;
end
$function$;

revoke execute on function public.record_paystack_seller_payout_event(text,text,bigint,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.record_paystack_seller_payout_event(text,text,bigint,text,jsonb)
  to service_role;
