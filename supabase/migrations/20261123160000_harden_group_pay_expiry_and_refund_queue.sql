-- Harden Group Pay expiry settlement and preserve contributor-level refund records.
alter table public.refunds_due
  add column if not exists contribution_id uuid references public.group_contributions(id),
  add column if not exists customer_id uuid,
  add column if not exists contributor_name text,
  add column if not exists payment_ref text;

create unique index if not exists refunds_due_group_contribution_uidx
  on public.refunds_due(contribution_id) where contribution_id is not null;

create or replace function public.contribute(
  p_code text, p_amount integer, p_name text, p_customer uuid, p_payment_ref text
)
returns table(accepted integer, excess integer, released integer)
language plpgsql security definer set search_path to ''
as $function$
declare
  l public.group_links;
  o public.orders;
  needed integer;
  took integer;
begin
  select * into l from public.group_links
    where code = upper(p_code) for update;
  if l.id is null then raise exception 'Unknown link'; end if;
  select * into o from public.orders where id = l.order_id for update;

  if exists (select 1 from public.group_contributions where payment_ref = p_payment_ref) then
    return query select 0, 0, 0; return;
  end if;

  if l.settled_at is not null or l.expires_at <= now()
     or o.status not in ('awaiting_payment', 'part_paid') or o.total_ngn <= o.paid_ngn then
    insert into public.refunds_due
      (source, ref_id, amount_ngn, customer_id, contributor_name, payment_ref)
    values ('group', l.id, p_amount, p_customer, coalesce(nullif(trim(p_name), ''), 'A friend'), p_payment_ref);
    return query select 0, p_amount, 0; return;
  end if;

  needed := o.total_ngn - o.paid_ngn;
  took := least(p_amount, needed);
  if took < 500 and took < needed then
    insert into public.refunds_due
      (source, ref_id, amount_ngn, customer_id, contributor_name, payment_ref)
    values ('group', l.id, p_amount, p_customer, coalesce(nullif(trim(p_name), ''), 'A friend'), p_payment_ref);
    return query select 0, p_amount, 0; return;
  end if;

  insert into public.group_contributions
    (link_id, contributor_name, customer_id, amount_ngn, payment_ref)
  values (l.id, coalesce(nullif(trim(p_name), ''), 'A friend'), p_customer, took, p_payment_ref);
  update public.orders set paid_ngn = paid_ngn + took where id = o.id;

  if p_amount > took then
    insert into public.refunds_due
      (source, ref_id, amount_ngn, customer_id, contributor_name, payment_ref)
    values ('group', l.id, p_amount - took, p_customer,
      coalesce(nullif(trim(p_name), ''), 'A friend'), p_payment_ref);
  end if;

  return query select took, p_amount - took,
    (select count(*)::integer from public.order_items where order_id = o.id and released_at is not null);
end
$function$;

create or replace function public.record_verified_payment(
  p_provider text, p_reference text, p_provider_transaction_id text,
  p_amount_ngn bigint, p_currency text, p_payload jsonb default '{}'::jsonb
)
returns boolean
language plpgsql security definer set search_path to ''
as $function$
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
  end if;

  update public.payment_transactions set status='success',
    provider_transaction_id=p_provider_transaction_id,
    provider_payload=coalesce(p_payload,'{}'::jsonb), verified_at=now()
    where id=payment.id;
  return true;
end
$function$;

create or replace function public.settle_group_links()
returns integer
language plpgsql security definer set search_path to ''
as $function$
declare l record; raised integer; kept integer; n integer := 0;
begin
  for l in
    select gl.id, gl.order_id from public.group_links gl
    where gl.settled_at is null and gl.expires_at <= now()
    order by gl.expires_at for update of gl skip locked
  loop
    select coalesce(sum(c.amount_ngn), 0)::integer into raised
      from public.group_contributions c where c.link_id = l.id;
    select coalesce(sum(i.unit_ngn * i.qty), 0)::integer into kept
      from public.order_items i
      where i.order_id = l.order_id and i.removed_at is null and i.released_at is not null;

    if raised > kept and raised > 0 then
      with shares as (
        select c.id, c.amount_ngn, c.customer_id, c.contributor_name, c.payment_ref,
          floor(kept::numeric * c.amount_ngn / raised)::integer as kept_share,
          (kept::numeric * c.amount_ngn / raised) - floor(kept::numeric * c.amount_ngn / raised) as fraction
        from public.group_contributions c where c.link_id = l.id
      ), ranked as (
        select *, row_number() over (order by fraction desc, id) as remainder_rank,
          kept - sum(kept_share) over () as remainder_units
        from shares
      )
      insert into public.refunds_due
        (source, ref_id, amount_ngn, contribution_id, customer_id, contributor_name, payment_ref)
      select 'group', l.id,
        amount_ngn - kept_share - case when remainder_rank <= remainder_units then 1 else 0 end,
        id, customer_id, contributor_name, payment_ref
      from ranked
      where amount_ngn - kept_share - case when remainder_rank <= remainder_units then 1 else 0 end > 0
      on conflict (contribution_id) where contribution_id is not null do nothing;
    end if;

    update public.order_items set removed_at = now()
      where order_id = l.order_id and released_at is null and removed_at is null;
    perform set_config('fastchina.note', 'Group Pay expired; funded items retained, unfunded items removed', true);

    if kept > 0 then
      update public.orders set total_ngn = kept, paid_ngn = kept,
        status = case when status = 'part_paid' then 'paid' else status end
      where id = l.order_id and status in ('awaiting_payment','part_paid');
    else
      update public.orders set paid_ngn = 0, status = 'cancelled'
      where id = l.order_id and status in ('awaiting_payment','part_paid');
    end if;

    update public.group_links set settled_at = now() where id = l.id;
    n := n + 1;
  end loop;
  return n;
end
$function$;

revoke all on function public.record_verified_payment(text,text,text,bigint,text,jsonb) from public, anon, authenticated;
grant execute on function public.record_verified_payment(text,text,text,bigint,text,jsonb) to service_role;
revoke all on function public.settle_group_links() from public, anon, authenticated;
grant execute on function public.settle_group_links() to service_role;

select cron.schedule('settle-expired-group-pay-links', '*/5 * * * *', 'select public.settle_group_links()');
