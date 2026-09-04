# What broke, and what it taught me

A build log of the real failures behind Vera, written during the Razorpay
Buildathon between 2 and 4 September 2026.

It includes the diagnoses that turned out to be wrong. Those are the entries
worth reading: every one of them looked obviously correct at the time, and each
cost real hours before the evidence contradicted it.

---

## 1. The payment modal opened with no key

**Symptom.** Razorpay Checkout opened and immediately died with *"Payment Failed
because of a configuration error. Authentication key was missing during
initialization."*

**First theory.** The Razorpay key in `.env` was wrong or malformed.

**What the evidence said.** The key was present and well formed — `rzp_test_`,
23 characters, secret 24 — so the file was fine. Calling the running API
directly showed the real problem:

```
{"message":"Razorpay order created successfully","razorpayOrder":{...}}
```

No `razorpayKeyId`. The field had been added to the route minutes earlier, but
the Node process was still running the old module in memory.

**Fix.** Restart the server.

**Lesson.** Node does not hot-reload. This cost time twice in one day before
restarting became a reflex before believing any diagnosis. A `--watch` flag
would have removed the whole class of error.

---

## 2. A backend error blanked the entire app

**Symptom.** The page went white after placing an order and stayed white until a
manual reload. It looked like a crash in the payment flow.

**What was actually happening.** `handleSend` pushed the API response into React
state without checking `response.ok`. An error body has no `validatedItems` or
`unavailableItems`, so the render then evaluated `.length` on `undefined`, threw
during render, and React 19 unmounted the whole tree.

It was never about placing an order. *Any* error response did it — a failing
model call, a 400, the backend restarting mid-request.

**Fix.** Treat a response as a proposal only when it is `ok` and both arrays are
present; otherwise render the server's message as text. Optional chaining in the
render as a second line of defence.

**Lesson.** The bug had been latent since the first commit. It surfaced only
because an unrelated dependency started failing. Outages find your untested
error paths for you.

---

## 3. Gemini failed three different ways in one day

The largest single source of lost time, and none of it was in our code.

**`429 RESOURCE_EXHAUSTED`** — the free tier allows 20 requests per day, per
project, per model. Exhausted by testing before it was known to be a limit.

**`503 UNAVAILABLE`** — *"This model is currently experiencing high demand."*
Unrelated to quota, and unfixable from our side.

**Silent hangs** — requests that never returned. One was left open for over four
minutes before being abandoned.

### Two wrong diagnoses worth recording

**"The browser was closed, so the API key went offline."** An API key has no
browser session. The failures were reproduced from a terminal script with no
browser running at all.

**"It is the MongoDB IP allowlist."** The audit trail disproved this in seconds:
`ORDER_REQUEST_RECEIVED` rows were still being written to MongoDB for exactly
the requests that were failing. If Mongo were unreachable, those writes would
have failed too. The audit trail built for the judges turned out to be the best
debugging tool in the project.

**Fix.** A 12-second timeout and one retry on transient `503` / `429` /
timeout, plus a distinct customer-facing message for an overloaded model rather
than a generic error. Worst case a customer now waits about 25 seconds instead
of forever.

**Lesson.** Establish whose outage it is before changing anything. Two of the
three theories above blamed our infrastructure; all three failures were Google's.

---

## 4. The standard test card was rejected

**Symptom.** *"International cards are not supported"* using
`4111 1111 1111 1111`, the number that appears in most Razorpay examples.

**Cause.** The test account has international cards disabled, and that Visa
number is classified as international.

**Fix.** A domestic test card, `5267 3181 8797 5449`. Netbanking with the
Success/Failure simulator proved more reliable still.

**Silver lining.** The rejection exercised the `payment.failed` path end to end
against real Razorpay behaviour — a harder thing to stage deliberately.

---

## 5. One click, two orders

**Symptom.** Two identical MongoDB order documents created three seconds apart
from a single customer action.

**Cause.** Nothing prevented a second submit while the first was in flight, and
nothing on the server recognised a repeat.

**Fix.** The confirm button locks on click and stays locked once the order
exists; the server fingerprints the cart and returns the existing order rather
than creating a second.

**Known limit, stated honestly.** The server guard is check-then-act, so two
genuinely simultaneous requests can still both insert. The button lock covers
the real-world double-click. Closing the race needs a unique partial index on
the fingerprint, which would collide with existing pending orders, so it was
deferred rather than rushed.

---

## 6. The server trusted the browser's arithmetic

**Symptom.** None. Nothing appeared broken.

**What was wrong.** `POST /api/orders` stored the `total` the browser sent. The
payment route then correctly built the Razorpay order from the *stored* total —
so the chain looked safe while its first link was not. A tampered request could
have persisted an arbitrary total and been charged exactly that.

**Fix.** The order route ignores client prices entirely: it re-runs catalog
validation on name and quantity and recomputes the total.

**Proof.** Posting an order with `total: 1` and `price: 1` for two Paracetamol
saves ₹40.

**Lesson.** The dangerous defect made no noise. It was found by reading the code
against the safety story, not by testing behaviour.

---

## 7. GitHub refused the first push

**Symptom.**

```
remote: error: GH007: Your push would publish a private email address.
```

**Cause.** All nine commits carried a personal Gmail as the author, and the
account blocks pushes that would expose it.

**Fix.** Rewrite the commits to the GitHub no-reply address. Safe here because
nothing had been pushed, so no shared history existed to break.

**Aftermath.** `filter-branch` leaves the originals in `refs/original`, which
still held the old address until those refs were deleted and the objects pruned.

---

## 8. PowerShell corrupted a git pipeline

**Symptom.**

```
fatal: delete refs/original/refs/heads/main: expected SP but got: ?
```

**Cause.** PowerShell pipes text as UTF-16 with a byte order mark.
`git update-ref --stdin` reads raw bytes and cannot parse it. The `?` in the
error is the BOM.

**Fix.** Use the direct form, `git update-ref -d <ref>`, or run the pipeline
from Git Bash.

**Lesson.** Any `... | git ... --stdin` pattern fails this way in PowerShell.

---

## 9. The audit trail told a slightly wrong story

**Symptom.** An order refused for exceeding the per-item quantity cap was
recorded as `STOCK_UNAVAILABLE`.

**Why it mattered.** Nothing was out of stock. The agent had declined to exceed
its own bound — the single behaviour the audit trail exists to evidence — and
the log described it as a warehouse problem.

**Fix.** Each rejection now carries a `kind` of `limit`, `stock` or `catalog`,
and the routes record `ORDER_LIMIT_EXCEEDED` or `STOCK_UNAVAILABLE` accordingly.

**Lesson.** An audit trail that records the wrong reason is worse than a coarser
one that records the right reason.

---

## 10. A refusal that left the customer stuck

**Symptom.** Ordering two available items and one unavailable one showed the
out-of-stock warning and hid everything else — no items, no total, no way
forward.

**Cause.** The proposal rendered only when `unavailableItems` was empty.

**Fix.** Problems render first, then the available items with the button
relabelled *"Confirm available items only"*. The server still re-validates at
confirm, so a stale cart is refused with a 400.

**Lesson.** Handling a failure is not the same as handling it gracefully. The
first version refused correctly and stranded the customer.

---

## What we would do differently

- **Restart before diagnosing.** Two separate investigations were of code that
  was not running.
- **Establish whose outage it is first.** Cheap to test, and it invalidated two
  confident theories.
- **Build the audit trail early.** It was built to satisfy a judging criterion
  and became the fastest debugging tool in the project.
- **Read the error paths as carefully as the happy path.** The white-screen bug
  and the trusted-total bug were both invisible while everything worked.
