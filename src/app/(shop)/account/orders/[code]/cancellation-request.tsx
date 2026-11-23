"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { requestOrderCancellation } from "../../actions";

type RequestStatus = "pending" | "approved" | "rejected";

export function CancellationRequest({ code, request }: {
  code: string;
  request: { status: RequestStatus; reason: string; staff_note: string | null; created_at: string } | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [busy, start] = useTransition();

  const submit = () => start(async () => {
    const result = await requestOrderCancellation(code, reason);
    setMessage(result.message);
    if (result.ok) {
      setOpen(false);
      setReason("");
      router.refresh();
    }
  });

  return (
    <section className="rounded-xl border border-line bg-white p-4">
      <h2 className="text-sm font-extrabold">Need to cancel this order?</h2>
      {request?.status === "pending" ? (
        <div className="mt-2 rounded-lg bg-surface p-3 text-sm">
          <p className="font-bold">Cancellation request submitted · Awaiting review</p>
          <p className="mt-1 text-muted">Your order has not been cancelled. Our team will check whether it has already been purchased from the factory.</p>
          <p className="mt-2 text-xs text-muted">Reason: {request.reason}</p>
        </div>
      ) : request?.status === "approved" ? (
        <div className="mt-2 rounded-lg bg-surface p-3 text-sm">
          <p className="font-bold text-success">Cancellation approved</p>
          <p className="mt-1 text-muted">The team has approved your request. Check the order status and refund balance below.</p>
          {request.staff_note && <p className="mt-2 text-muted">{request.staff_note}</p>}
        </div>
      ) : request?.status === "rejected" ? (
        <div className="mt-2 rounded-lg bg-surface p-3 text-sm">
          <p className="font-bold">Cancellation request not approved</p>
          {request.staff_note && <p className="mt-1 text-muted">{request.staff_note}</p>}
          <p className="mt-1 text-xs text-muted">If you believe this decision is incorrect, contact FastChina support.</p>
        </div>
      ) : (
        <>
          <p className="mt-1 text-xs leading-relaxed text-muted">You can request cancellation before FastChina buys the item from the factory. The request is reviewed by our team; submitting it does not cancel the order immediately.</p>
          {!open ? (
            <button type="button" onClick={() => setOpen(true)} className="mt-3 min-h-10 rounded-full border border-ink px-4 text-xs font-bold">Request cancellation</button>
          ) : (
            <div className="mt-3 flex flex-col gap-2">
              <label htmlFor="cancellation-reason" className="text-xs font-bold">Why do you want to cancel?</label>
              <textarea id="cancellation-reason" value={reason} onChange={(e) => setReason(e.target.value)} minLength={10} maxLength={1000} rows={4} placeholder="Tell us why you want to cancel this order (at least 10 characters)." className="w-full rounded-lg border border-line p-3 text-sm outline-none focus:border-ink" />
              <p className="text-[11px] text-muted">{reason.trim().length}/1,000 characters</p>
              <div className="flex gap-2">
                <button type="button" disabled={busy || reason.trim().length < 10} onClick={submit} className="min-h-10 rounded-full bg-ink px-4 text-xs font-bold text-white disabled:opacity-40">{busy ? "Submitting…" : "Submit request"}</button>
                <button type="button" disabled={busy} onClick={() => setOpen(false)} className="min-h-10 px-3 text-xs font-bold text-muted">Keep order</button>
              </div>
            </div>
          )}
        </>
      )}
      {message && <p role="status" className="mt-2 text-xs text-muted">{message}</p>}
    </section>
  );
}
