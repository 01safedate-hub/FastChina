"use server";

import { allow, TOO_MANY } from "@/lib/rate-limit";
import { hasSupabase, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/supabase/env";
import { userDb } from "@/lib/supabase/auth";

export async function startOrderPayment(input: {
  code: unknown;
  phone: unknown;
  email: unknown;
  provider: unknown;
  amountNgn: unknown;
}): Promise<{ ok: true; checkoutUrl: string } | { ok: false; message: string }> {
  if (!hasSupabase) return { ok: false, message: "Payments are unavailable while the database is disconnected." };
  if (input.provider !== "paystack" && input.provider !== "flutterwave") return { ok: false, message: "Choose a payment provider." };
  const code = typeof input.code === "string" ? input.code.trim().toUpperCase() : "";
  const phoneDigits = typeof input.phone === "string" ? input.phone.replace(/\D/g, "") : "";
  const phone = phoneDigits.startsWith("234") ? `+${phoneDigits}` : phoneDigits.startsWith("0") ? `+234${phoneDigits.slice(1)}` : "";
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const amountNgn = Number(input.amountNgn);
  if (!/^[A-Z0-9]{8}$/.test(code) || !/^\+234[789][01]\d{8}$/.test(phone)) return { ok: false, message: "Order details could not be validated." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return { ok: false, message: "Enter a valid email address for your payment receipt." };
  if (!Number.isSafeInteger(amountNgn) || amountNgn <= 0) return { ok: false, message: "Invalid payment amount." };
  if (!(await allow("payment-start", 5, 600))) return { ok: false, message: TOO_MANY };

  const { data: sessionData } = await (await userDb()).auth.getSession();
  const token = sessionData.session?.access_token || SUPABASE_PUBLISHABLE_KEY;
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/create-payment`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: "order", code, phone, email, provider: input.provider, amountNgn }),
      cache: "no-store",
    });
    const result = await response.json();
    if (!response.ok || result.ok !== true || typeof result.checkoutUrl !== "string") {
      return { ok: false, message: typeof result.message === "string" ? result.message : "The payment provider could not start checkout." };
    }
    return { ok: true, checkoutUrl: result.checkoutUrl };
  } catch {
    return { ok: false, message: "We couldn't connect to the payment service. Please try again." };
  }
}

export async function startGroupContribution(input: {
  code: unknown; amountNgn: unknown; email: unknown; contributorName: unknown; provider: unknown;
}): Promise<{ok:true;checkoutUrl:string}|{ok:false;message:string}> {
  if (!hasSupabase) return {ok:false,message:"Payments are unavailable while the database is disconnected."};
  if (input.provider !== "paystack" && input.provider !== "flutterwave") return {ok:false,message:"Choose a payment provider."};
  const code = typeof input.code === "string" ? input.code.trim().toUpperCase() : "";
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const amountNgn = Number(input.amountNgn);
  const contributorName = typeof input.contributorName === "string" ? input.contributorName.trim().slice(0,60) : "";
  if (!/^[A-Z0-9-]{4,20}$/.test(code)) return {ok:false,message:"This Group Pay link is invalid."};
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return {ok:false,message:"Enter a valid email address for your receipt."};
  if (!Number.isSafeInteger(amountNgn) || amountNgn < 500) return {ok:false,message:"The minimum contribution is ₦500."};
  if (!(await allow("group-payment-start",5,600))) return {ok:false,message:TOO_MANY};
  const {data:sessionData} = await (await userDb()).auth.getSession();
  const token = sessionData.session?.access_token || SUPABASE_PUBLISHABLE_KEY;
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/create-payment`,{
      method:"POST",headers:{"Content-Type":"application/json",apikey:SUPABASE_PUBLISHABLE_KEY,Authorization:`Bearer ${token}`},
      body:JSON.stringify({action:"group_contribution",code,email,amountNgn,contributorName,provider:input.provider}),cache:"no-store"
    });
    const result = await response.json();
    if (!response.ok || result.ok !== true || typeof result.checkoutUrl !== "string") return {ok:false,message:typeof result.message==="string"?result.message:"The payment provider could not start checkout."};
    return {ok:true,checkoutUrl:result.checkoutUrl};
  } catch { return {ok:false,message:"We couldn't connect to the payment service. Please try again."}; }
}
