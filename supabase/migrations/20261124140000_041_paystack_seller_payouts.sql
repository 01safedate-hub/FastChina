-- Phase 5: Paystack seller disbursements, verified payout accounts and safe transfer reconciliation.
alter table public.stores
  add column if not exists payout_bank_code text,
  add column if not exists payout_account_verified_at timestamptz,
  add column if not exists paystack_recipient_code text;

alter table public.seller_payouts
  add column if not exists transfer_reference text,
  add column if not exists transfer_code text,
  add column if not exists transfer_status text not null default 'not_started',
  add column if not exists transfer_payload jsonb not null default '{}'::jsonb,
  add column if not exists transfer_updated_at timestamptz;

alter table public.seller_payouts drop constraint if exists seller_payouts_status_check;
alter table public.seller_payouts add constraint seller_payouts_status_check
  check (status = any (array['pending','processing','awaiting_approval','paid','failed','needs_review']::text[]));
alter table public.seller_payouts add constraint seller_payouts_transfer_status_check
  check (transfer_status = any (array['not_started','processing','awaiting_approval','success','failed','reversed','needs_review']::text[]));
create unique index if not exists seller_payouts_transfer_reference_uidx
  on public.seller_payouts(transfer_reference) where transfer_reference is not null;

-- Existing unverified bank details are deliberately not eligible for automatic transfer.
-- Sellers must re-confirm their bank using Paystack account resolution before the first automated payout.
create or replace function public.claim_seller_payout_transfers(p_limit integer default 20)
returns table(payout_id uuid, amount_ngn integer, reference text, recipient_code text)
language plpgsql security definer set search_path = '' as $$
declare p record; v_ref text;
begin
  for p in
    select sp.id, sp.store_id, sp.amount_ngn, s.paystack_recipient_code
    from public.seller_payouts sp
    join public.stores s on s.id = sp.store_id
    where sp.status = 'pending'
      and sp.transfer_status = 'not_started'
      and s.status <> 'suspended'
      and s.payout_account_verified_at is not null
      and s.paystack_recipient_code is not null
    order by sp.created_at, sp.id
    limit greatest(1, least(coalesce(p_limit,20),50))
    for update of sp skip locked
  loop
    v_ref := 'fcsp-' || replace(p.id::text,'-','');
    update public.seller_payouts sp
      set status='processing', transfer_status='processing',
          transfer_reference=v_ref, transfer_updated_at=now()
      where sp.id=p.id;
    payout_id := p.id; amount_ngn := p.amount_ngn; reference := v_ref;
    recipient_code := p.paystack_recipient_code;
    return next;
  end loop;
end $$;

create or replace function public.set_seller_payout_transfer_state(
  p_reference text, p_status text, p_transfer_code text default null, p_payload jsonb default '{}'::jsonb
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare p public.seller_payouts;
begin
  select * into p from public.seller_payouts
   where transfer_reference=p_reference for update;
  if p.id is null then return false; end if;
  if p.transfer_status in ('success','failed','reversed') then return true; end if;
  if p_status not in ('processing','awaiting_approval','success','failed','needs_review') then
    raise exception 'Unsupported payout transfer state';
  end if;
  update public.seller_payouts
    set transfer_status=p_status,
        transfer_code=coalesce(p_transfer_code,transfer_code),
        transfer_payload=coalesce(p_payload,'{}'::jsonb),
        transfer_updated_at=now(),
        status=case p_status
          when 'success' then 'paid'
          when 'awaiting_approval' then 'awaiting_approval'
          when 'processing' then 'processing'
          when 'failed' then 'failed'
          when 'needs_review' then 'needs_review'
          else status end,
        reference=case when p_status='success' then p_reference else reference end,
        paid_at=case when p_status='success' then coalesce(paid_at,now()) else paid_at end
    where id=p.id;
  if p_status='failed' then
    delete from public.seller_payout_adjustment_applications where payout_id=p.id;
    update public.order_items set payout_id=null where payout_id=p.id;
  end if;
  return true;
end $$;

create or replace function public.record_paystack_seller_payout_event(
  p_reference text, p_status text, p_amount_kobo bigint, p_currency text, p_payload jsonb
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare p public.seller_payouts;
begin
  select * into p from public.seller_payouts where transfer_reference=p_reference for update;
  if p.id is null then return false; end if;
  if p_amount_kobo <> p.amount_ngn::bigint * 100 or p_currency <> 'NGN' then
    raise exception 'Paystack payout amount or currency mismatch';
  end if;
  if p.transfer_status='success' then return true; end if;
  if p_status='success' then
    update public.seller_payouts set status='paid',transfer_status='success',
      reference=p_reference,paid_at=coalesce(paid_at,now()),transfer_payload=coalesce(p_payload,'{}'::jsonb),transfer_updated_at=now()
      where id=p.id;
  elsif p_status='failed' then
    update public.seller_payouts set status='failed',transfer_status='failed',
      transfer_payload=coalesce(p_payload,'{}'::jsonb),transfer_updated_at=now() where id=p.id;
    delete from public.seller_payout_adjustment_applications where payout_id=p.id;
    update public.order_items set payout_id=null where payout_id=p.id;
  elsif p_status='reversed' then
    -- A reversal after a successful credit needs staff reconciliation; never auto-resubmit it.
    update public.seller_payouts set status='needs_review',transfer_status='reversed',
      transfer_payload=coalesce(p_payload,'{}'::jsonb),transfer_updated_at=now() where id=p.id;
  else
    return false;
  end if;
  return true;
end $$;

revoke execute on function public.claim_seller_payout_transfers(integer) from public, anon, authenticated;
revoke execute on function public.set_seller_payout_transfer_state(text,text,text,jsonb) from public, anon, authenticated;
revoke execute on function public.record_paystack_seller_payout_event(text,text,bigint,text,jsonb) from public, anon, authenticated;
grant execute on function public.claim_seller_payout_transfers(integer) to service_role;
grant execute on function public.set_seller_payout_transfer_state(text,text,text,jsonb) to service_role;
grant execute on function public.record_paystack_seller_payout_event(text,text,bigint,text,jsonb) to service_role;

-- The worker runs every five minutes. Vault secret payout_cron_secret must match
-- the PAYOUT_CRON_SECRET Edge Function secret. No transfer runs until both exist.
select cron.unschedule('fc-seller-payout-transfers') where exists (select 1 from cron.job where jobname='fc-seller-payout-transfers');
select cron.schedule(
  'fc-seller-payout-transfers',
  '*/5 * * * *',
  $job$
    select net.http_post(
      url := current_setting('app.settings.supabase_url', true) || '/functions/v1/seller-payouts',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'x-payout-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='payout_cron_secret' limit 1)
      ),
      body := '{"action":"process_due"}'::jsonb
    );
  $job$
);
