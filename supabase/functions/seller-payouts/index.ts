import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const paystackSecret = () => Deno.env.get("PAYSTACK_SECRET_KEY") ?? "";
const api = async (path: string, init: RequestInit = {}) => {
  const secret = paystackSecret();
  if (!secret) throw new Error("Paystack transfers are not configured.");
  const response = await fetch(`https://api.paystack.co${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const payload = await response.json();
  if (!response.ok || payload?.status !== true) throw new Error(typeof payload?.message === "string" ? payload.message : "Paystack request failed.");
  return payload.data;
};
const dbClient = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-payout-cron-secret", "Access-Control-Allow-Methods": "POST, OPTIONS" } });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const db = dbClient();
  try {
    const body = await req.json().catch(() => ({}));
    const action = body?.action;

    if (action === "banks") {
      const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\\s+/i, "");
      const { data: authData, error: authError } = await db.auth.getUser(token);
      if (authError || !authData.user) return json({ error: "Sign in to continue." }, 401);
      const banks = await api("/bank?country=nigeria&currency=NGN&perPage=100");
      return json({ banks: (banks ?? []).filter((b: any) => b.active !== false).map((b: any) => ({ name: String(b.name), code: String(b.code) })) });
    }

    if (action === "verify_bank") {
      const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\\s+/i, "");
      const { data: authData, error: authError } = await db.auth.getUser(token);
      if (authError || !authData.user) return json({ error: "Sign in to continue." }, 401);
      const account = typeof body.account_number === "string" ? body.account_number.replace(/\\D/g, "") : "";
      const bankCode = typeof body.bank_code === "string" ? body.bank_code.trim() : "";
      if (!/^\\d{10}$/.test(account) || !/^\\d{2,8}$/.test(bankCode)) return json({ error: "Enter a valid 10-digit account number and bank." }, 400);
      const resolved = await api(`/bank/resolve?account_number=${encodeURIComponent(account)}&bank_code=${encodeURIComponent(bankCode)}`);
      if (!resolved?.account_name) return json({ error: "Paystack could not verify this account." }, 422);
      return json({ account_name: String(resolved.account_name), bank_name: String(resolved.bank_name ?? "") });
    }

    if (action === "save_bank") {
      const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\\s+/i, "");
      const { data: authData, error: authError } = await db.auth.getUser(token);
      if (authError || !authData.user) return json({ error: "Sign in to continue." }, 401);
      const account = typeof body.account_number === "string" ? body.account_number.replace(/\\D/g, "") : "";
      const bankCode = typeof body.bank_code === "string" ? body.bank_code.trim() : "";
      if (!/^\\d{10}$/.test(account) || !/^\\d{2,8}$/.test(bankCode)) return json({ error: "Enter a valid bank account." }, 400);
      const resolved = await api(`/bank/resolve?account_number=${encodeURIComponent(account)}&bank_code=${encodeURIComponent(bankCode)}`);
      const suppliedName = typeof body.confirmed_account_name === "string" ? body.confirmed_account_name.trim() : "";
      const resolvedName = String(resolved?.account_name ?? "");
      if (!resolvedName || suppliedName.toLowerCase() !== resolvedName.toLowerCase()) return json({ error: "The account name does not match Paystack's verified name. Confirm the displayed name and try again." }, 422);
      const { data: store, error: storeError } = await db.from("stores").select("id").eq("owner_id", authData.user.id).maybeSingle();
      if (storeError || !store) return json({ error: "Open a store first." }, 404);
      const recipient = await api("/transferrecipient", { method: "POST", body: JSON.stringify({
        type: "nuban", name: resolvedName, account_number: account, bank_code: bankCode, currency: "NGN",
        description: `FastChina seller payout ${store.id}`, metadata: { store_id: store.id },
      }) });
      const { error: updateError } = await db.from("stores").update({
        bank_name: String(resolved?.bank_name ?? body.bank_name ?? ""),
        account_number: account, account_name: resolvedName, payout_bank_code: bankCode,
        payout_account_verified_at: new Date().toISOString(), paystack_recipient_code: String(recipient.recipient_code),
      }).eq("id", store.id);
      if (updateError) throw updateError;
      return json({ ok: true, account_name: resolvedName, bank_name: String(resolved?.bank_name ?? body.bank_name ?? "") });
    }

    const cronSecret = Deno.env.get("PAYOUT_CRON_SECRET");
    if (!cronSecret || req.headers.get("x-payout-cron-secret") !== cronSecret) return json({ error: "Unauthorized" }, 401);
    if (action !== "process_due") return json({ error: "Unsupported action" }, 400);

    // Reconcile transfers already accepted by Paystack before claiming new batches.
    // Ambiguous submissions in needs_review are deliberately not re-submitted.
    const { data: inFlight, error: inFlightError } = await db.from("seller_payouts")
      .select("id,transfer_reference,amount_ngn")
      .in("transfer_status", ["processing","awaiting_approval","needs_review"])
      .not("transfer_reference","is",null)
      .order("transfer_updated_at",{ascending:true}).limit(50);
    if (inFlightError) throw inFlightError;
    for (const payout of inFlight ?? []) {
      try {
        const verified = await api(`/transfer/verify/${encodeURIComponent(payout.transfer_reference)}`);
        const state = String(verified?.status ?? "").toLowerCase();
        if (!["success","failed","reversed"].includes(state)) continue;
        const { error } = await db.rpc("record_paystack_seller_payout_event", {
          p_reference: payout.transfer_reference, p_status: state,
          p_amount_kobo: Number(verified.amount), p_currency: String(verified.currency ?? ""),
          p_payload: verified,
        });
        if (error) throw error;
      } catch (error) {
        console.error("Transfer reconciliation deferred", payout.id, error instanceof Error ? error.message : "unknown error");
      }
    }

    // Claiming is atomic. A payout that has entered processing is never submitted twice.
    const { data: jobs, error: claimError } = await db.rpc("claim_seller_payout_transfers", { p_limit: 20 });
    if (claimError) throw claimError;
    let submitted = 0;
    let needsReview = 0;
    for (const job of jobs ?? []) {
      try {
        if (!job.recipient_code) {
          await db.rpc("set_seller_payout_transfer_state", { p_reference: job.reference, p_status: "needs_review", p_payload: { reason: "Missing verified Paystack recipient" } });
          needsReview++;
          continue;
        }
        const result = await api("/transfer", { method: "POST", body: JSON.stringify({
          source: "balance", amount: Number(job.amount_ngn) * 100, recipient: job.recipient_code,
          reference: job.reference, reason: `FastChina seller payout ${job.payout_id}`, currency: "NGN",
        }) });
        const providerStatus = String(result?.status ?? "pending").toLowerCase();
        // Never mark a payout paid from the initiation response alone. Final settlement
        // is accepted only after the transfer verify endpoint or signed webhook confirms it.
        const state = providerStatus === "otp" ? "awaiting_approval" : "processing";
        await db.rpc("set_seller_payout_transfer_state", { p_reference: job.reference, p_status: state, p_transfer_code: result?.transfer_code ?? null, p_payload: result });
        submitted++;
      } catch (error) {
        // A network error can happen after Paystack accepted the transfer. Never retry
        // an ambiguous submission automatically; verification/manual review is safer.
        await db.rpc("set_seller_payout_transfer_state", {
          p_reference: job.reference, p_status: "needs_review",
          p_payload: { error: error instanceof Error ? error.message : "Unknown transfer error", ambiguous_submission: true },
        });
        needsReview++;
      }
    }
    return json({ ok: true, claimed: (jobs ?? []).length, submitted, needs_review: needsReview });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Payout operation failed." }, 500);
  }
});
