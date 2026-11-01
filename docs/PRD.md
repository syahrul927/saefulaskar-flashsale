# Flash Sale & Jubelio Sync — Product Requirements Document

**Version:** 1.1
**Date:** 2026-10-23
**Status:** Draft — Pending Jubelio API credential access for field validation

---

## 1. Overview

### 1.1 Purpose

FlashStudio is a B2B/B2C flash sale platform for Saeful Askar Enterprise. Enables admin to run time-limited clearance sessions with fixed SKU allocations sourced from **Jubelio WMS** (ERP/OMS). Customers checkout via transfer, confirm via WhatsApp. Sales orders and invoices created in Jubelio. Local database mirrors data for session management and transaction control.

### 1.2 Scope

| What we build | External (Jubelio) |
|---|---|
| Admin Console (session manager) | Product catalog & real-time stock |
| Customer Storefront | Sales Order creation |
| Cart + Checkout flow | Invoice creation |
| Local DB (session + orders) | Webhook listeners |
| WhatsApp payment confirmation | Bank accounts (.env) |
| Google login + auto contact creation | Contact creation in Jubelio |

**Note:** Payment flow uses bank transfer + WhatsApp proof confirmation. No real payment gateway integration in v1.

---

## 2. System Architecture

```
Customer Storefront          Admin Console
       │                           │
       │                      [Pick products]
       │                      from Jubelio
       │                           │
       ▼                           ▼
   ┌─────────────────────────────────┐
   │       FlashStudio App           │
   │  ┌───────────┐  ┌────────────┐  │
   │  │ Local DB  │  │  Jubelio    │  │
   │  │ - sessions│  │  Integration│  │
   │  │ - orders  │  │  (REST API) │  │
   │  │ - invoices│  │             │  │
   │  │ - contacts│  │             │  │
   │  └───────────┘  └────────────┘  │
   └─────────────────────────────────┘
                    │
         ┌───────────────┐
         │  WhatsApp     │
         │  (link to     │
         │  send proof) │
         └───────────────┘
```

---

## 3. Jubelio API Integration

**Base URL (new):** `https://open.jubelio.com/core-api/`
**Base URL (legacy):** `https://api2.jubelio.com` (possibly deprecated)
**Auth:** Bearer token (JWT, same format)
**Doc:** `https://docs-wms.jubelio.com` — ⚠️ **Not 100% valid.** Some endpoints deprecated/moved. Need trial & error to confirm.

**Known working endpoint:**
```
GET /core-api/locations/?page=1&pageSize=200
```

All endpoints may require `/core-api/` prefix. Test each one — 404 = deprecated, try new domain.

---

### 3.1 Product / SKU Lookup

Used by admin when building a flash sale session.

| Method | Endpoint | Use |
|---|---|---|
| GET | `/inventory/items/by-sku/{sku}` | Get single product by SKU code |
| GET | `/inventory/items/masters` | Get all master products |
| GET | `/inventory/items/` | Get all product groups |
| GET | `/inventory/` | Get all products with stock info |

**`GET /inventory/items/by-sku/{sku}` — Response (`getProductResponse`):**

```
product_skus[]     — array of SKU variants
  sku_code         — SKU identifier string
  item_id          — Jubelio item ID
  stock            — current stock qty
  sell_price       — standard sell price
  buy_price        — buy price
  uom_id / uom_name — unit of measure
item_group_id      — product group ID
item_group_name    — product name
variations[]       — variant list (color, size, etc.)
is_active          — boolean
status             — number
```

Admin picks products from Jubelio catalog. Stock = **live data** — always fetch fresh at session setup and during CO to prevent overselling. Admin can override **sessionQuota**, **minOrder**, **flashPrice**.

**Stock oversell guard:** At checkout, re-fetch live stock. If `availableStock < requestedQty`, block CO and show "Stock tidak mencukupi."

---

### 3.2 Customer Registration (Onboarding)

Triggered on new customer sign-up (Google login).

**`POST /contacts/`** — Create customer contact in Jubelio

Required fields (`saveContactRequest`):
```
contact_id       : 0               (use 0 to create new)
contact_name     : <string>        (Nama perusahaan/toko)
contact_type     : 0               (0 = Customer)
primary_contact  : <string>        (Nama PIC)
contact_position : <string>        (Jabatan: 'pemilik' | 'procurement')
phone            : <string>        (No. Telf PIC)
mobile           : <string>        (Alternative phone)
s_address        : <string>        (Alamat lengkap pengiriman)
is_reseller      : true
```

Optional:
```
email, s_city, s_province, s_post_code, notes
```

**Flow:**
1. Customer signs up with Google → receives JWT
2. App calls `POST /contacts/` in Jubelio → stores returned `contact_id` in local `contacts` table
3. Future checkouts reuse same `contact_id`

---

### 3.3 Sales Order — Create

Triggered on **admin confirms payment** (booking → SO in Jubelio).

**`POST /sales/orders/`** — Create/Edit Sales Order

Required fields (`saveSalesOrderRequest`):
```
salesorder_id    : 0               (use 0 to create new)
salesorder_no    : "[auto]"        (auto-generate)
contact_id       : <number>        (from contacts.contact_id)
customer_name    : <string>        (from contact_name)
transaction_date : <date>         (ISO date)
location_id      : <number>       (warehouse location)
source           : 1               (1 = Internal)
is_paid          : true            (instant paid — payment already confirmed)
channel_status   : "paid"          (⚠ REQUIRED — see note below)
store_id         : -100            (⚠ REQUIRED — "Toko Default")
is_tax_included  : false           (⚠ REQUIRED)
payment_method   : ""              (⚠ key REQUIRED; the value is empty, NOT
                                   "transfer" — live capture 2026-10-29)
items[]          : <array>
  item_id         : <number>       (from product_skus.item_id)
  item_name       : <string>
  sku             : <string>
  qty             : <number>
  price           : <number>
  discount        : <number>
  tax             : <number>
  uom_id          : <number>
  warehouse_id    : <number>
  warehouse_name  : <string>
sub_total        : <number>
total_disc       : <number>
total_tax        : <number>
grand_total      : <number>
add_disc         : 0
add_fee          : 0
service_fee      : 0
```

Optional:
```
shipping_full_name, shipping_address, shipping_city,
shipping_district, shipping_zipcode, shipping_courier,
courier, note, ref_no
```

`note` and `ref_no` are optional upstream but always sent (empty) — the payload
mirrors the dashboard request key-for-key; `tests/confirm-order.test.ts` pins
that key set.

**Response:** `{ id: <salesorder_id> }` — the key is `id`, **not**
`salesorder_id` (that name belongs to list/detail rows). Parsing `data
.salesorder_id` answered "Jubelio tidak mengembalikan salesorderId" while the SO
had already been created and paid. See `readSalesOrderId`.

> **Note:** `is_paid: true` alone is not enough. Omit `channel_status`/`store_id`/
> `is_tax_included` and Jubelio creates the row at `wms_status: "UNKNOWN"`, then
> rejects its own transition with `Status Sekarang: UNKNOWN, Status Dituju: PAID`
> — leaving an orphan SO that no longer accepts a second confirm. With all four
> flags the SO lands `internal=PAID / channel=Paid / wms=PAID` (verified live).
> Status transitions after that (PAID → SHIPPED → COMPLETED) happen inside
> Jubelio's own warehouse flow and are read back by polling — see §4.2/§4.3, not
> webhooks.

---

### 3.4 Invoice — Create

After sales order is created and packed, convert to invoice.

**`POST /sales/packlists/create-invoice`** — Convert Sales Order to Invoice

```
salesorder_ids[]  : array of salesorder IDs
```

**`POST /sales/invoices/`** — Create/Edit Invoice directly

Required fields:
```
invoice_id      : 0           (0 = create new)
invoice_no      : "[auto]"
customer_name   : <string>
due_date        : <date>
location_id     : <number>
is_opening_balance : false
items[]         : <array>
```

---

### 3.5 Query Invoices

| Method | Endpoint |
|---|---|
| GET | `/sales/invoices/` |
| GET | `/sales/invoices/{id}` |
| GET | `/sales/invoices/unpaid/` |
| GET | `/sales/invoices/overdue/` |

---

### 3.6 Webhooks

| Event (prose docs) | Trigger | Action in our system |
|---|---|---|
| `invoice` | Invoice created/updated | **Not used** — under observation, see §4.6 |
| `salesorder` | Order created/changed (e.g. status transitions) | **Not used** — order status arrives by polling |
| `stock` | Stock change (orders, transfers, returns) | **Not used** — quota comes from `/inventory/items/all-stocks/` |
| `payment` | Price change (⚠ see note) | **Not used** — payment confirmed via WhatsApp |

> **There is no registration endpoint.** This section used to say webhooks are
> registered via `POST /webhooks/{type}`; that path does not exist. Checked against
> the live `https://open.jubelio.com/core-api/swagger.json` (472 paths) on
> 2026-10-31: the only `webhook` path is `POST /webhook/sales-order`, which
> *resends* the sales-order callback for the SO ids you name
> (`{"ids":[192297]}`). Registration is dashboard-only — Pengaturan → Developer →
> Webhook, one callback URL per event type, no place to add a header.
>
> **Not implemented in the order flow.** No webhook is consumed by anything that
> writes order state. The only receiver in `src/` is a **probe sink**
> (`POST /api/jubelio/webhook-sink/[token]`, §4.6) that records what Jubelio
> actually sends into two debug tables and cannot touch `orders.status`; it is
> closed unless `JUBELIO_WEBHOOK_SINK_TOKEN` is set. Order status and resi arrive
> by **polling the SO by id** (§4.2/§4.3).
>
> Payment confirmation is: WhatsApp proof upload → admin clicks Konfirmasi Bayar →
> we create the SO with `is_paid: true` + `channel_status: "paid"`. The SO lands
> directly at `internal_status: "PAID"`, which maps to local **CONFIRMED** — there
> is no UNPAID or intermediate phase inside Jubelio. (`payment` webhook describes
> price change, not payment received.)

**No payload shape is known.** Any field list for a webhook body would be a guess —
there is nothing in the live spec describing a delivery body, and we have never
captured one. That is deliberate now: the probe sink (§4.6) exists to record the
first real delivery instead of us assuming its shape. The one lesson carried over
from the SO header: `is_shipped` is the wrong gate (it is `null` even on shipped
SOs, §4.3) and the field is `shipper`, not `courier`. Do not code against either
name until a capture proves it.

---

### 3.7 Stock Adjustments

Used when we need to reserve quota outside of order flow:

| Method | Endpoint |
|---|---|
| POST | `/inventory/reserved/` — Create Reserved Stock |
| GET | `/inventory/reserved/` — Get Reserved Stock List |
| POST | `/inventory/adjustments/` — Stock adjustment |

---

## 4. Data Synchronization Strategy

| Data | Sync Method | When |
|---|---|---|
| Products / SKUs | **Live fetch** (on-demand) | Admin creates session + at checkout CO |
| Orders / Sales Orders | **Polling, `GET /sales/orders/{id}`** | Vercel daily cron + optional external pinger (hourly) + throttled pass when an admin opens the orders page (`ORDER_SYNC_INTERVAL_MS`, default 5 min) |
| Stock | **Live fetch** at session setup and at checkout | No webhook receiver — `/inventory/items/all-stocks/` on demand |
| Invoices | not synced | No invoice surface in this app |
| Order status | **same poll as above** | no webhook receiver exists in `src/` (§3.6) |

### 4.1 Product — Live Fetch (On-Demand)

When admin opens Jubelio product picker, fetch **live** product data:
- `GET /inventory/items/masters` → all products (for browse/search)
- `GET /inventory/items/by-sku/{sku}` → single product by SKU
- `POST /inventory/items/all-stocks/` → all products + stock per location

**At customer checkout:** re-fetch stock before confirming CO. Block if `availableStock < requestedQty`.

**Category:** Manual input — not from Jubelio `item_category_id`. Admin inputs category tag per product.

### 4.2 Orders / Invoices / Sales Orders — Polling (Daily)

Daily background job:
```
GET /sales/orders/                   → all SOs
GET /sales/orders/{id}              → single SO
GET /sales/invoices/                 → all invoices
GET /sales/invoices/{id}            → single invoice
```

**Corrected against live responses (probe 2026-10-29).** A sales-order row has
NO `status` field — the earlier claim that it reads `status = "Completed"` was
wrong, and it is why the sync written from this section reported `synced: 0`
every night. Status lives in three fields, each with its own vocabulary:

| Field | Observed values |
|---|---|
| `internal_status` | `PENDING, PAID, PROCESSING, SHIPPED, COMPLETED, CANCELED` |
| `channel_status` | `UNPAID, Paid, READY_TO_SHIP, Processing, delivered, remitted, refunded` |
| `wms_status` | `PENDING, PAID, SHIPPED, COMPLETED, CANCELED, UNKNOWN` |

**`internal_status` → local status mapping** (the sync reads this one field):
| Jubelio | Local |
|---|---|
| *(no SO yet)* | UNPAID (booking) |
| `PAID` | CONFIRMED |
| `SHIPPED` | **CONFIRMED** — SHIPPED is skipped (§4.6); the resi from the same response is what says "shipped" |
| `COMPLETED` | COMPLETED |
| `PENDING` / `PROCESSING` / `CANCELED` / anything else | left as-is (no local equivalent) |

The sync only ever moves a local status FORWARD — a stale SO reading `PAID`
cannot pull an order back, and a row already sitting on a legacy `SHIPPED` is
never pulled back to `CONFIRMED` either (`STATUS_RANK` keeps that value ranked so
history stays ahead of the two-state ladder).

**Reads are per-SO by id, never the list.** `GET /sales/orders/` holds 184 072
rows at 200/page, page 1 is 2022-era marketplace traffic, and `page_size` /
`sort` / `order` are rejected by the upstream schema — so our own orders are
not reachable through it. `GET /sales/orders/{id}` returns the header (status +
`tracking_number` + `shipper`) and is the only usable read.

Save to local DB on every sync. Triggers: the Vercel daily cron, an optional
external hourly pinger, and a throttled pass when an admin opens the orders page
(`ORDER_SYNC_INTERVAL_MS`, default 5 min).

### 4.3 Resi / AWB Tracking

No dedicated shipment webhook is wired up in this app; the status sync carries the
resi instead. Fields as actually observed on the SO header (probe 2026-10-29):
```
tracking_number    ← resi/AWB number ("" on a freshly created SO)
shipper            ← courier name, free text ("SiCepat HALU", "Grab Same Day")
tn_created_date    ← when the AWB was created
internal_status    ← SHIPPED once it has moved
```
`is_shipped` and `marked_as_complete` are `null` even on shipped and completed
SOs — do not gate anything on them.

Handler (in `src/server/daily-sync.ts` + `src/server/order-sync.ts`): the sync
copies `tracking_number` → `orders.tracking_number` and `shipper` →
`orders.shipper` whenever the SO carries one and we don't already have it. This
happens **whether or not the local status moves** — which matters now that SHIPPED
is skipped (§4.6): an order that stays `CONFIRMED` for the customer still gets its
resi. No `shipped_at` column: `updated_at` covers it, and Jubelio gives no shipped
date on the header. Courier names are free text with no carrier→site mapping, so
the UI offers copy, not a tracking link.

The resi strip (`ShipmentBand`) renders on the presence of a tracking number, not
on a status, so it needs no change for the skipped status — and a legacy `SHIPPED`
row still shows its resi like any other.

**What we do NOT use:** the `GET /sales/orders/` list (184 072 rows at 200/page,
`page_size`/`sort`/`order` rejected by its Joi schema — a page-1 sweep never
reaches our orders), and `GET /wms/sales/shipped/` +
`POST /wms/sales/shipments/orders/`, which are listed upstream but have never been
probed from this app.

### 4.4 Bank Accounts (Payment)

Defined in `.env` or `bank-accounts.json` in project root:
```json
[
  { "bank": "BCA", "account_number": "1234567890", "account_name": "PT FlashStudio" },
  { "bank": "Mandiri", "account_number": "0987654321", "account_name": "PT FlashStudio" }
]
```

Displayed to customer at checkout. Customer uploads proof of transfer via WhatsApp link.

### 4.5 Payment Confirmation Flow

**Phase 1 — Booking (local only, no Jubelio SO yet):**
1. Customer checkout → local order created (status: **UNPAID**, booking_id assigned)
2. Customer shown bank account options (from `.env`)
3. Customer transfers to chosen account
4. Customer clicks "Kirim Bukti Transfer" → WhatsApp opens with pre-filled text + screenshot attachment

**Phase 2 — Confirmation (creates Jubelio SO as instant paid):**
5. Admin sees pending bookings in dashboard (order number + transfer screenshot)
6. Admin verifies screenshot matches amount → clicks "Konfirmasi Bayar"
7. App creates SO in Jubelio with `is_paid: true` + `channel_status: "paid"` +
   `store_id: -100` + `is_tax_included: false` → **instant PAID** (no UNPAID phase;
   omit any of those four and Jubelio 500s mid-transition, see §3.3)
8. App reads the SO id off the response (`{ id }`) → local order status
   **CONFIRMED**, `jubelio_so_id` stored. No id parsed = 502 **and no local write** —
   the SO may already exist, so the message tells the admin to check Jubelio rather
   than click again.
9. Status sync (§4.2/§4.3) reads the SO by id and moves the local row
   CONFIRMED → COMPLETED, filling `tracking_number`/`shipper` on the way.
   Forward-only; a CANCELED SO leaves the local row untouched. There is no
   SHIPPED step any more (§4.6) — a shipped SO keeps the row at CONFIRMED and
   delivers the resi.

### 4.6 Status Ladder & Jubelio Observation Rig

**The customer ladder is three steps:** `UNPAID → CONFIRMED → COMPLETED`. SHIPPED
was dropped from it on request — one status per thing the customer needs to know,
and "paid" and "out of our hands" are the two they asked about.

**Skipped, not deleted.** The `order_status` PG enum keeps `SHIPPED`, the columns
keep their values, `ShipmentBand` stays, and rows already written as `SHIPPED`
stay `SHIPPED` and still render ("Dikirim"). Only the *writer* changed: nothing in
`src/` can produce a SHIPPED order now (`SyncStatus` no longer admits it), and the
customer's status pills replaced `DIKIRIM` with `DIPROSES`. No migration, no
history rewrite.

**COMPLETED copy.** The badge reads `DIPROSES` and the card line under it says:
*"Order sudah diproses atau dikirim — hubungi CS untuk informasi lebih lanjut."*
with "hubungi CS" as a WhatsApp deep link (`buildCsLink` — deliberately not the
payment-proof `waLink`). The label cannot claim "Selesai"/arrived, because COMPLETED
now covers both processed and shipped and we cannot tell them apart from the SO
header. Full design and rationale: spec §4.7.

**Why a rig instead of just building the webhook.** The next step the user asked
for — flag COMPLETED when Jubelio creates the faktur, via webhook — rests on two
unknowns: what a Jubelio webhook body contains, and which SO fields a created
invoice moves. Upstream documents neither, and a wrong guess here already produced
four orphan `UNKNOWN` sales orders. So:

| Piece | Path | Purpose |
|---|---|---|
| Probe sink | `POST /api/jubelio/webhook-sink/[token]` | Record any POST Jubelio fires: verbatim body, credential-redacted headers, and whether the payload carries a joinable `salesorder_id` / `invoice_id` / `ref_no` |
| Snapshot diff | `POST /api/admin/jubelio/snapshot` + `/admin/jubelio` | Read `GET /sales/orders/{id}` on demand, store it, and diff it against that SO's previous read — snapshot, create the faktur, snapshot again |
| Bench page | `/admin/jubelio` (admin nav → "Jubelio") | The sink URL to copy into Pengaturan → Developer → Webhook, the linked orders, the capture log, the snapshot history |

Storage is two throwaway tables — `webhook_captures` (self-pruning to the newest
200) and `jubelio_so_snapshots` (kept, since each row is a deliberate reading).
Neither is read by any order flow, and neither can write `orders.status`. The sink
is closed unless `JUBELIO_WEBHOOK_SINK_TOKEN` is set.

**Held until the rig answers:** wiring a faktur-created webhook into the status
sync, and whether the daily cron stays once a manual sync button exists.

---

## 5. User Stories

### Admin

- **AS-01** — Login to Admin Console, see active session details (name, time, status)
- **AS-02** — Open Jubelio product picker, search by SKU/name, browse **live** stock levels
- **AS-03** — Add product to session with auto-populated stock + price from Jubelio
- **AS-04** — Override sessionQuota, minOrder, flashPrice per product; set category (manual input)
- **AS-05** — See KPI panel: products allocated, total quota, claimed, estimated GMV
- **AS-06** — Set session start/end time, set status (SCHEDULED / ACTIVE / PAUSED / ENDED)
- **AS-07** — Verify customer payment proof uploaded via WhatsApp, mark order as PAID
- **AS-08** — See daily sync job results; track Completed orders from Jubelio
- **AS-09** — Open the Jubelio bench (`/admin/jubelio`), copy the sink callback URL, snapshot a sales order and read what changed since the last snapshot (§4.6)

### Customer

- **CS-01** — Login with Google → auto-create contact in Jubelio → stored locally
- **CS-02** — View live flash deals catalog with countdown timer
- **CS-03** — Filter by category (admin-defined tags)
- **CS-04** — See quota bar (claimed/total) per product; sold-out overlay when exhausted
- **CS-05** — Add to cart (starts at MOQ qty), increment/decrement with MOQ floor enforced
- **CS-06** — Quick buy (add + open cart)
- **CS-07** — Checkout: enter/confirm address, select bank transfer account
- **CS-08** — See order in Transaction History with status badge (Belum Bayar / Dikonfirmasi / Diproses — filter pills, no SHIPPED step, §4.6), and on a COMPLETED order the line "Order sudah diproses atau dikirim — hubungi CS untuk informasi lebih lanjut" with a working CS link
- **CS-09** — View order number (booking_id) + bank account info on UNPAID orders
- **CS-10** — Click "Kirim Bukti Transfer" → WhatsApp opens with pre-filled text + attachment prompt for screenshot
- **CS-11** — View receipt/invoice with tracking number, courier, delivery address

---

## 6. Key Decisions / Open Questions

| # | Question | Status |
|---|---|---|
| 1 | Payment flow (real VA, settlement webhook) | **Resolved** — transfer only, WhatsApp proof confirmation |
| 2 | Customer login | **Resolved** — Google login, auto-generate contact_id via `POST /contacts/` |
| 3 | New customer form fields | **Resolved** — Nama, Nama PIC, Jabatan dropdown, No. Telf PIC, Alamat lengkap |
| 4 | Customer address/contact creation flow | **Resolved** — `POST /contacts/` on Google sign-up |
| 5 | Category source | **Resolved** — manual input per product, not from Jubelio |
| 6 | Stock sync strategy | **Resolved** — live fetch at session setup + at CO; no webhook receiver implemented |
| 7 | Order Completed trigger | **Resolved (as far as we can go today)** — SO header `internal_status = "COMPLETED"` (not `order_status`; the field doesn't exist on the header). Full mapping in §4.2. The requested "faktur created ⇒ COMPLETED" trigger is **held on evidence**: see §4.6 / spec §4.7 |
| 8 | Polling interval for daily sync | **Resolved** — Vercel cron 00:00 UTC + optional external hourly pinger to `POST /api/cron/daily-sync` + throttled pass on admin-orders view (`ORDER_SYNC_INTERVAL_MS`, default 300000 ms; `ORDER_SYNC_AWAIT_MS` caps how long the page waits, default 4000 ms) |
| 9 | `location_id` — how to map to our warehouse | **Needs Jubelio** — query `/locations/` |
| 10 | Stock reservation (pre-allocate vs. on-order) | **TBD** — may use `/inventory/reserved/` for flash sale quota |
| 11 | Webhook secret/authentication | **Open, by observation** — no webhook is consumed by the order flow. Jubelio's dashboard gives no place to put an auth header on a callback, so the probe sink authenticates with a secret path segment (`JUBELIO_WEBHOOK_SINK_TOKEN`, unset ⇒ closed). Whether Jubelio signs its deliveries at all is one of the findings: the sink keeps every non-credential header. `/api/cron/daily-sync` is guarded by `CRON_SECRET` and accepts either `x-cron-secret: <secret>` (external pingers) or `Authorization: Bearer <secret>` on GET **or** POST — the bearer-on-GET form is what Vercel's own cron sender sends |
| 17 | SHIPPED as a customer-facing status | **Resolved** — dropped (§4.6). Skipped, not deleted: enum, columns, legacy rows and the resi strip stay; nothing writes the value. "Diproses" (COMPLETED) is the last step |
| 12 | WhatsApp link format | **Pending** — wa.me/ number + pre-filled text template |
| 13 | API base URL | **Resolved** — use `https://open.jubelio.com/core-api/` (new domain); old `api2.jubelio.com` possibly deprecated |
| 14 | API docs reliability | **Known issue** — docs not 100% valid. Some endpoints moved/deprecated. Need trial & error per endpoint. |
| 15 | `location_id` — Jubelio | **Resolved** — `GET /core-api/locations/` works on new domain. Set in `.env` as `JUBELIO_LOCATION_ID`. |
| 16 | Confirm idempotency (a retry must not make a second paid SO) | **Open** — candidate: send `ref_no = orders.booking_id` and verify-then-adopt on an ambiguous failure. Blocked on an unknown: marketplace SOs carry `ref_no` and their `salesorder_no` becomes `SP-<ref_no>` instead of our `SO-000…`, so this may change how our SOs are numbered. Do not click Konfirmasi Bayar twice on a failed confirm until this lands. |

---

## 7. API Quick Reference

### Auth
```
POST /login   body { email, password }   → { token, fullName, userName, currentCompany, nik }
Authorization: Bearer <token>
```
Sending `companyId` in the body is rejected: `400 "companyId" is not allowed`. The
response key is `token` — not `access_token`, which this section used to claim.

### Product Setup
```
GET  /inventory/items/by-sku/{sku}                  → product + SKU variants + stock
GET  /inventory/items/masters                       → all master products
GET  /inventory/items/                               → product groups list
POST /inventory/reserved/                            → reserve stock
```

### Order & Invoice
```
POST /sales/orders/                        → create sales order
GET  /sales/orders/{id}                    → get order by ID
POST /sales/packlists/create-invoice       → convert SO → invoice
POST /sales/invoices/                      → create invoice directly
GET  /sales/invoices/{id}                  → get invoice
```

### Customer Data
```
POST /contacts/                            → create customer (onboarding)
GET  /contacts/{id}                        → get customer
```

### Webhooks (NOT used by this app, see §3.6)
```
POST /webhook/sales-order   body { "ids": [<salesorder_id>, …] }   → RESEND the SO callback
```
That is the only `webhook` path in the live spec — the `POST /webhooks/invoice` /
`/webhooks/salesorder` / `/webhooks/stock` registration endpoints this section
used to list do not exist (verified against `/core-api/swagger.json`, 472 paths,
2026-10-31). Registration is dashboard-only, and this app consumes nothing.

### Endpoints this app actually calls
```
POST /login                                → system-account token (12 h expiry)
POST /contacts/                            → customer onboarding
GET  /inventory/items/by-sku/{sku}         → product + stock
POST /inventory/items/all-stocks/          → stock sweep
POST /sales/orders/                        → confirm (create SO, instant PAID)
GET  /sales/orders/{id}                    → status sync (status + resi), and the bench snapshot (§4.6)
```

---

## 8. Configuration

### Bank Accounts — `bank-accounts.json`

```json
[
  {
    "bank": "BCA",
    "account_number": "1234567890",
    "account_name": "PT FlashStudio"
  },
  {
    "bank": "Mandiri",
    "account_number": "0987654321",
    "account_name": "PT FlashStudio"
  }
]
```

Or via `.env`:
```
BANK_ACCOUNTS=[{"bank":"BCA","account_number":"1234567890","account_name":"PT FlashStudio"},{"bank":"Mandiri","account_number":"0987654321","account_name":"PT FlashStudio"}]
```

### Order status sync — `.env`

```
# How often the throttled pass is allowed to run, process-wide. 0 disables the
# throttle so every admin-orders view sweeps (dev only — it multiplies upstream
# calls by the number of linked orders).
ORDER_SYNC_INTERVAL_MS=300000
# Longest the admin orders page waits for that sweep before rendering what the
# DB already has; the run finishes in the background via after(). 0 = never
# block, statuses appear on the next reload.
ORDER_SYNC_AWAIT_MS=4000
# Guards /api/cron/daily-sync (GET and POST). Vercel's own cron sender presents
# it as `Authorization: Bearer <CRON_SECRET>` on a GET; external pingers can use
# either that or `x-cron-secret: <CRON_SECRET>`.
# Required and non-empty — `emptyStringAsUndefined` in src/env.js means
# `CRON_SECRET=""` fails validation at boot, not "no auth".
CRON_SECRET="<random string>"
# Jubelio probe sink (§4.6). Optional, and `""` is the same as unset: the public
# POST endpoint then answers 503 and stores nothing. Set it only while probing,
# copy the URL from /admin/jubelio into Jubelio's dashboard, clear it afterwards.
JUBELIO_WEBHOOK_SINK_TOKEN=""
```

Both sync vars are `z.coerce.number()` and have defaults, so they are optional in
`.env`. Vercel Hobby allows one daily cron (`vercel.json`: `0 0 * * *`); for
hourly freshness point an external pinger (cron-job.org, GitHub Actions schedule)
at `POST /api/cron/daily-sync` with the `x-cron-secret` header.

---

## 9. Non-Functional

- **Session data**: stored locally, not in Jubelio
- **Offline resilience**: storefront works against local session_products if Jubelio unreachable (read-only product data cached)
- **Quota enforcement**: local `claimed` counter managed in-app, Jubelio stock checked live at CO
- **Oversell guard**: re-fetch stock before CO — block if insufficient
- **Payment simulation**: not needed — real transfer flow via WhatsApp proof in v1
