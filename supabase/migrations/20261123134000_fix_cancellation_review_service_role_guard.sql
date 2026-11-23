create or replace function public.review_order_cancellation_request(p_request uuid, p_approve boolean, p_note text default null)
returns text
language plpgsql security definer set search_path = ''
as $function$
declare r public.order_cancellation_requests; result_status text;
begin
  -- The RPC is executable only by service_role; the Next.js server action separately
  -- authenticates staff with requireStaff() before calling it.
  if current_setting('role', true) <> 'service_role' then raise exception 'Service role required'; end if;
  select * into r from public.order_cancellation_requests where id = p_request for update;
  if r.id is null then raise exception 'Cancellation request not found'; end if;
  if r.status <> 'pending' then raise exception 'Cancellation request has already been reviewed'; end if;

  if p_approve then
    select public.cancel_or_refund(r.order_id, coalesce(nullif(trim(p_note), ''), 'Customer cancellation request')) into result_status;
    update public.order_cancellation_requests
      set status = 'approved', staff_note = nullif(left(trim(coalesce(p_note, '')), 1000), ''), reviewed_at = now()
      where id = r.id;
    perform public.notify(r.customer_id, 'order', 'Cancellation approved',
      'Your cancellation request has been approved. Your order has been cancelled and any refund due has been credited according to our Refunds policy.',
      '/account/orders', null, null, 'cancel-reviewed:' || r.id || ':approved');
    return result_status;
  end if;

  update public.order_cancellation_requests
    set status = 'rejected', staff_note = nullif(left(trim(coalesce(p_note, '')), 1000), ''), reviewed_at = now()
    where id = r.id;
  perform public.notify(r.customer_id, 'order', 'Cancellation request update',
    coalesce(nullif(trim(p_note), ''), 'Your cancellation request was not approved. Please contact FastChina support if you need help.'),
    '/account/orders', null, null, 'cancel-reviewed:' || r.id || ':rejected');
  return 'rejected';
end
$function$;
revoke execute on function public.review_order_cancellation_request(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.review_order_cancellation_request(uuid, boolean, text) to service_role;