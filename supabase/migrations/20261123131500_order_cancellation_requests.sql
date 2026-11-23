-- Customer cancellation requests. Requests never cancel/refund an order automatically:
-- staff must review the factory-purchase stage and approve through cancel_or_refund().
create table public.order_cancellation_requests (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  customer_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (char_length(reason) between 10 and 1000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  staff_note text check (staff_note is null or char_length(staff_note) <= 1000),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
create index order_cancellation_requests_order_idx on public.order_cancellation_requests(order_id, created_at desc);
create unique index order_cancellation_requests_one_pending_idx
  on public.order_cancellation_requests(order_id) where status = 'pending';

alter table public.order_cancellation_requests enable row level security;
create policy "cancellation requests: owner or staff read"
  on public.order_cancellation_requests for select
  using (customer_id = (select auth.uid()) or public.is_staff());
grant select on public.order_cancellation_requests to authenticated;

create or replace function public.request_order_cancellation(p_code text, p_reason text)
returns uuid
language plpgsql security definer set search_path = ''
as $function$
declare
  o public.orders;
  request_id uuid;
  clean_reason text := nullif(trim(p_reason), '');
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if p_code is null or p_code !~* '^[A-Z0-9]{8}$' then raise exception 'Invalid order reference'; end if;
  if clean_reason is null or char_length(clean_reason) < 10 or char_length(clean_reason) > 1000 then
    raise exception 'Please provide a reason between 10 and 1,000 characters';
  end if;

  select * into o from public.orders
  where code = upper(p_code) and customer_id = auth.uid()
  for update;
  if o.id is null then raise exception 'Order not found'; end if;

  -- FastChina's published terms permit cancellation only before factory purchase.
  if o.status not in ('awaiting_payment', 'part_paid', 'paid', 'purchasing') then
    raise exception 'This order has passed the cancellation stage in our policy';
  end if;
  if o.pay_mode = 'group' and o.paid_ngn > 0 and o.paid_ngn < o.total_ngn then
    raise exception 'Group pay orders with contributions cannot be cancelled until fully funded';
  end if;
  if exists (select 1 from public.order_cancellation_requests r where r.order_id = o.id and r.status = 'pending') then
    raise exception 'A cancellation request is already awaiting review';
  end if;

  insert into public.order_cancellation_requests(order_id, customer_id, reason)
  values (o.id, auth.uid(), clean_reason)
  returning id into request_id;

  perform public.notify(auth.uid(), 'order', 'Cancellation request received · #' || o.code,
    'We have received your request and our team will review whether the order is still eligible for cancellation. Your order has not been cancelled yet.',
    '/account/orders/' || o.code, null, null, 'cancel-request:' || request_id);
  return request_id;
end
$function$;

revoke execute on function public.request_order_cancellation(text, text) from public, anon;
grant execute on function public.request_order_cancellation(text, text) to authenticated;
