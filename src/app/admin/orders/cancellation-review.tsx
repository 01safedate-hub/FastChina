"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { reviewCancellationRequest } from "../actions";

export function CancellationReview({ request }: {
  request: { id: string; reason: string; status: "pending" | "approved" | "rejected"; staff_note: string | null; created_at: string };
}) {
  const router = useRouter();
  const [note, setNote] = useState(request.staff_note ?? "");
  const [message, setMessage] = useState("");
  const [busy, start] = useTransition();
  const decide = (approve: boolean) => start(async () => {
    const result = await reviewCancellationRequest(request.id, approve, note);
    setMessage(result.message);
    if (result.ok) router.refresh();
  });

  return (
    <div className="rounded-md border border-[#F0D4A8] bg-[#FFFAF0] p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong>Customer cancellation request</strong>
        <span className="rounded-full bg-white px-2 py-1 text-xs font-bold">{request.status}</span>
      </div>
      <p className="mt-2 whitespace-pre-wrap">{request.reason}</p>
      {request.status === "pending" ? (
        <>
          <label className="mt-3 block text-xs font-semibold" htmlFor={`cancel-note-${request.id}`}>Staff note (optional; shown to customer)</label>
          <textarea id={`cancel-note-${request.id}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={2} className="mt-1 w-full rounded border border-[#D0D4DB] bg-white p-2 text-xs" />
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => decide(true)} className="min-h-9 rounded-md bg-[#18794E] px-3 font-bold text-white disabled:opacity-50">Approve &amp; refund</button>
            <button type="button" disabled={busy} onClick={() => decide(false)} className="min-h-9 rounded-md border border-[#B42318] px-3 font-bold text-[#B42318] disabled:opacity-50">Decline request</button>
          </div>
        </>
      ) : request.staff_note && <p className="mt-2 text-xs text-[#5B6170]">Staff note: {request.staff_note}</p>}
      {message && <p role="status" className="mt-2 text-xs">{message}</p>}
    </div>
  );
}
