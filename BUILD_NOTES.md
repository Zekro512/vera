# Vera — what was built, what was simplified, what was cut

An honest account of the scope, written so it can be spoken to directly if asked.

---

## Fully implemented and tested

**Conversational order extraction.** Gemini turns a plain-language message into
product names and quantities. It is prompted to return nothing else — no prices,
no stock — and nothing downstream would read those fields if it did.

**Trusted catalog validation.** `catalogService` resolves each requested product,
rejects unknown items, invalid quantities, and quantities above stock, and prices
everything from the server-side catalog.

**Bounded order size.** A per-item quantity cap and a per-order value ceiling,
both read from the environment so the operator sets them and the agent cannot.
Enforced in `catalogService` at proposal time and again in `/api/orders`, so a
client that skips the chat step entirely is still bounded. A breach is refused
with `ORDER_LIMIT_EXCEEDED` in the audit trail, not merely flagged.

**Server-side pricing.** `/api/orders` ignores prices and totals sent by the
browser. It re-validates the requested items and recomputes the total. Verified by
posting an order with a forged `total: 1`, which was saved as ₹40.

**Razorpay Checkout, Test Mode.** The modal opens with the amount Razorpay
returned for the server-created order. The public key ID is sent to the browser;
the secret never leaves the server.

**Signature verification.** `/api/payments/verify` recomputes
`HMAC-SHA256(order_id|payment_id)` with the Razorpay secret and compares it with
`timingSafeEqual` behind a length guard. It is the only code path that can write
`status: "paid"`. The order is located by `razorpayOrderId` rather than by an ID
the caller supplies, so a valid signature cannot be redirected at a different
order. Re-verifying an already-paid order is a no-op.

**Failure and cancellation.** `/api/payments/abandon` records a cancelled or
failed payment. It can only move an order out of `payment_pending`, and returns
409 on an order that has already settled.

**Audit trail.** Nine event types across the whole lifecycle, written
server-side only, in a dedicated collection. Audit failures are swallowed so they
can never break a customer's payment.

**Duplicate protection.** Cart fingerprint check on the server plus a Confirm
button that locks on click.

### How each path was verified

| Path | Result | Method |
| --- | --- | --- |
| Successful payment | `paid` + payment ID stored | Real Checkout payment |
| Customer cancels | `cancelled` | Closed the modal |
| Checkout reports failure | `payment_failed` | Card rejected by Razorpay |
| Forged signature | HTTP 400, `payment_failed` | curl with a fake signature |
| Client-supplied price | Ignored, repriced from catalog | curl with `total: 1` |
| Duplicate confirm | One order reused | Two sequential POSTs |
| Out-of-stock item | Rejected, `STOCK_UNAVAILABLE` | curl and UI |
| Order above the value ceiling | HTTP 400, `ORDER_LIMIT_EXCEEDED` | curl and UI |
| Quantity above the per-item cap | Rejected at validation | curl and unit check |
| Changing a settled order | HTTP 409 | curl |

Every result above was confirmed by reading the database, not by trusting a
success message in the UI.

---

## Simplified

**Audit trail is a flat collection, not a per-order event log.** Chat-stage events
carry a null `orderId` because no order exists yet, so reconstructing a single
customer's journey means correlating by timestamp. It is readable and complete;
it is not a rich queryable event store.

**The chat UI is minimal.** Order state is surfaced through browser alerts rather
than inline UI. Function over polish.

**Catalog is a static file** rather than a database collection, so stock levels
reset whenever the server restarts.

**No session or cart concept.** Each chat message is independent; there is no
running cart a customer builds up across turns.

**Clarification works in one direction only.** The agent correctly flags a vague
request such as "I need something for a headache" with `needsClarification`. The
customer can answer, but only with a self-contained message: "make it 2
Paracetamol" resolves, "yes 3 of those" does not, because no prior turn is
retained. Tested, not assumed. A named product without a quantity, such as
"I need Crocin", is not treated as ambiguous at all — the model defaults to a
quantity of 1 and the order proceeds.

---

## Deliberately not built

**Atomic stock decrement on payment success.** The demo validates stock before
proposing an order and again at confirm time, but never decrements it. A
production version would decrement inside a transaction on verified payment and
release the reservation if verification failed. This is the most significant cut
and the one most worth naming first.

**A fully race-proof duplicate guard.** The current guard is check-then-act, so
two genuinely simultaneous requests can both insert. The button lock covers the
real-world double-click. Closing the race properly needs a unique partial index
on a cart fingerprint.

**Rate limiting and deep input sanitization.** Nothing stops a client hammering
`/api/chat` and burning Gemini quota.

**Authentication and order ownership.** No accounts, so no order belongs to
anyone. The endpoints are written so this is not exploitable for money: nothing a
client can call reaches `paid`.

**A hard link between chat-stage events and the order they became.** Events
recorded before an order exists have no order to point at, so
`GET /api/audit/:orderId` correlates them by a 10-minute lookback and labels them
as such. Carrying a conversation ID from the first message through to the order
would make the link exact.

**Webhook-based payment confirmation.** Verification is driven by the browser
returning from Checkout. If the customer closes the tab at the wrong moment, a
genuinely successful payment can be left at `payment_pending`. Razorpay webhooks
are the production answer, since they arrive server-to-server regardless of what
the browser does.

---

## If asked "what would I do next?"

1. Atomic stock decrement in a transaction on verified payment.
2. Razorpay webhooks, so payment state does not depend on the browser.
3. A unique partial index to close the duplicate-order race.
4. Rate limiting on the LLM-backed endpoints.
