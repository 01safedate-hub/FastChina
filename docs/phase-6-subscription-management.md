# Phase 6 — Seller subscription management and renewal

Branch: `feat/phase-6-subscription-management`

## Included

- Seller-facing **Manage subscription** page with plan, expiry, Free-plan sales allowance, and billing history.
- Explicit opt-in for automatic subscription renewal; existing sellers remain opted out.
- Wallet-first renewal worker runs every five minutes.
- A renewal is charged from the wallet only when the full monthly plan price is available.\n- Once an external checkout is opened, wallet retries pause for that billing cycle to prevent a wallet debit and an external payment both succeeding.
- Wallet deductions are recorded as negative `wallet_ledger` entries with reason `subscription_renewal`.
- Renewal attempts are idempotent per store and due date. An insufficient-wallet attempt is retried by the worker if the wallet is later funded.
- If the wallet cannot cover the full renewal, the seller is notified and the Manage subscription page offers external checkout through Paystack or Flutterwave.
- External renewal checkout can renew the seller's existing plan; activation still happens only through the existing server-side payment verification and `record_verified_payment()`.
- Successful external subscription payment marks the renewal status as renewed.
- Seller navigation continues to expose **Manage subscription**.

## Important external-payment behavior

The current fallback is an external hosted checkout that the seller must complete. It does not silently debit a stored card or bank mandate. Paystack reusable authorizations and Flutterwave card tokens require explicit payment-method consent and provider-specific tokenization/authorization handling. That separate stored-payment-method feature is not enabled by this change.

## Existing business rules preserved

- Free: 20 active products, ₦2,000,000 lifetime sales limit, 5% fee on seller markup.
- Pro: ₦15,000/month, 200 active products, 3% fee on seller markup.
- Elite: ₦45,000/month, 100,000 product cap (application presents as unlimited), 1.5% fee on seller markup.
- The existing `set_store_plan()` expiry extension and `expire_store_plans()` downgrade/grace-period behavior are retained.
- Existing payment verification remains server-side. Browser redirects do not activate plans.
- No 20% FastChina commission was introduced.

## Migrations

- `20261125100000_035_seller_subscription_history.sql`: owner-scoped billing history RPC.
- `20261125120000_036_wallet_first_subscription_renewals.sql`: opt-in renewal settings, idempotent renewal ledger, wallet-first worker, and five-minute cron.
- `20261125130000_037_subscription_renewal_retry_and_external_completion.sql`: retry after wallet top-up and renewal-status reconciliation after verified external payment.\n- `20261125140000_038_run_wallet_renewals_before_expiry_sweep.sql`: run wallet renewal processing before the existing three-day expiry/grace-period downgrade.\n- `20261125150000_039_prevent_wallet_and_external_renewal_double_charge.sql`: pause wallet retries while an external renewal checkout is active.

Existing sellers are not automatically enrolled. They must enable the setting from Manage subscription.
