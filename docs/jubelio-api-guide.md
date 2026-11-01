# Jubelio API — Exploration Guide

**Base URL:** `https://api2.jubelio.com`
**Docs:** `https://docs-wms.jubelio.com`
**Spec:** `https://docs-wms.jubelio.com/dist.yaml` (OpenAPI YAML — download directly)

---

## 1. How the Docs Work

The docs site is a **SPA** (ReDoc). Browser renders it. Plain `WebFetch` can't see content — it only shows the shell.

**To explore programmatically:**
```bash
# Download the full OpenAPI spec (31k lines YAML)
curl -sL https://docs-wms.jubelio.com/dist.yaml -o /tmp/jubelio-openapi.yaml
```

Load with Python + PyYAML:
```python
import yaml
data = yaml.safe_load(open('/tmp/jubelio-openapi.yaml'))
paths = data['paths']   # all endpoints
schemas = data['components']['schemas']  # all request/response models
```

---

## 2. Key API Categories

```
/inventory/*    — Product catalog, stock, SKUs, adjustments
/sales/*         — Orders, invoices, shipments, payments
/contacts/*      — Customer/vendor contact management
/wms/*           — Warehouse operations (pick, pack, ship)
/webhook/*       — Resend the sales-order callback (§8; registration is UI-only)
/login           — Auth token generation
```

---

## 3. Auth

```
POST /login
Body: { "email": "...", "password": "..." }
Response: { "access_token": "..." }

Header for all requests:
  Authorization: Bearer <access_token>

Token expires 12 hours.
```

---

## 4. Product & SKU Discovery

**For admin session setup — live fetch:**

```python
# All master products (list)
GET /inventory/items/masters

# Single product by SKU code
GET /inventory/items/by-sku/{sku}

# All products + stock per location
POST /inventory/items/all-stocks/
Body: { "location_id": 1 }

# Get all product groups
GET /inventory/items/
```

**`getProductResponse` key fields:**
```
item_group_id, item_group_name
product_skus[] → { sku_code, item_id, stock, sell_price, buy_price }
variations[]   → color, size, etc.
is_active
item_category_id
min, max        → MOQ (minimum purchase qty)
```

**To find `location_id`:**
```python
GET /locations/   → list warehouses
```

---

## 5. Sales Order

**Create SO (required for checkout integration):**

```
POST /sales/orders/
```

`saveSalesOrderRequest` — required fields:
```
salesorder_id    : 0              (0 = create new)
salesorder_no    : "[auto]"       (auto-generate)
contact_id       : <number>       ← must exist in Jubelio
customer_name    : <string>
transaction_date : <date>
location_id      : <number>       ← warehouse
source           : 1             (1 = Internal)
items[]          : [ … ]
sub_total, total_disc, total_tax, grand_total
```

⚠ The upstream `items[]` shape (`item_id, item_name, sku, qty, price, discount,
tax, uom_id, warehouse_id`) is NOT what a working create takes. The 15 keys the
dashboard actually sends — and that this app sends — are:
```
salesorder_detail_id : 0        (0 = new line)
item_id              : <number>
qty_in_base          : <number>  ← not `qty`
unit                 : <string>  ← not `uom_id`
price                : <number>
amount               : qty_in_base * price
disc, disc_amount, tax_amount : 0
tax_id               : 1
location_id          : <number>  ← per line, same as the header
description          : <string>  ← not `item_name`; no `sku` at all
channel_order_detail_id : null
shipper, tracking_no : ""
```

⚠ The upstream "required" list above is not sufficient in practice. An SO created
without these three additionally lands at `wms_status: "UNKNOWN"` and Jubelio then
rejects its own transition with `Status Sekarang: UNKNOWN, Status Dituju: PAID`
(500), leaving an orphan SO that refuses a retry:
```
channel_status   : "paid"       ← what actually drives the paid state
store_id         : -100          ← "Toko Default"
is_tax_included  : false
payment_method   : ""            ← key must be present; value empty
```
`note` and `ref_no` are optional upstream but sent empty so the body matches the
dashboard request key-for-key. Verified live 2026-10-29: a full-flag create comes
back `internal_status: PAID / channel_status: Paid / wms_status: PAID`.

**Response:** `{ "id": <salesorder_id> }` — the key is `id`. `salesorder_id` is the
name used on *list and detail rows*, not on the create response; reading
`data.salesorder_id` after create yields `undefined`.

**Get SO:**
```
GET /sales/orders/{id}       → by ID — header fields at top level + items[].
                               This is what our status sync reads.
GET /sales/orders/           → first page only. 184 072 rows at 200/page, sorted
                               oldest-first (page 1 = 2022 marketplace orders),
                               and `page_size` / `sort` / `order` are REJECTED by
                               its Joi schema (live probe 2026-10-29). Not usable
                               for a status sweep; `?q=` works for diagnostics.
GET /wms/sales/shipped/      → shipped orders (has tracking_number) — listed in
                               upstream docs, never probed from this app.
```

**Update AWB (tracking number):**
```
POST /sales/orders/save-airwaybill/
Body: { "salesorder_id": ..., "awb": "...", "courier": "JNE" }
```

---

## 6. Invoice

**Create directly:**
```
POST /sales/invoices/
```

Required: `invoice_id: 0`, `invoice_no: "[auto]"`, `customer_name`, `due_date`, `location_id`, `is_opening_balance: false`, `items[]`

**Convert SO → Invoice:**
```
POST /sales/packlists/create-invoice
Body: { "salesorder_ids": [123, 456] }
Response: { id, invoice_no }
```

**Query:**
```
GET /sales/invoices/
GET /sales/invoices/{id}
GET /sales/invoices/unpaid/
GET /sales/invoices/overdue/
```

---

## 7. Contact (Customer)

**Create contact before SO — required for `contact_id`:**

```
POST /contacts/
Body:
  contact_id     : 0          (0 = create new)
  contact_name   : "CV Mitra Sukses"
  contact_type   : 0          (0 = Customer)
  phone          : "0812..."
  mobile         : "..."
  s_address      : "Full shipping address"
  s_city         : "Jakarta"
  s_city_id      : <number>
  s_province     : "DKI Jakarta"
  s_province_id  : <number>
  s_post_code    : "12345"
```

**Search existing customers:**
```
GET /contacts/customers/?search=...
GET /contacts/{id}
```

**Note:** SO requires valid `contact_id`. Either:
- Create contact on first checkout → cache `contact_id` in local DB
- Or reuse a default "guest" contact ID (pre-created in Jubelio admin)

---

## 8. Webhooks

⚠ **Not used by the order flow.** Order status and resi come from polling
`GET /sales/orders/{id}` (§9). What now exists is an **observation sink** —
`POST /api/jubelio/webhook-sink/[token]`, see spec §4.7 — whose only job is to
record whatever Jubelio actually sends. It writes two probe tables and cannot move
`orders.status`. Nothing consumes a webhook in production.

**Correcting what this guide used to claim:**

- `POST /systemsetting/webhook` **does not exist.** There is no registration
  endpoint anywhere in the live spec. Verified against
  `https://open.jubelio.com/core-api/swagger.json` (OpenAPI 2.0, 472 paths,
  318 definitions) on 2026-10-31 — the only path containing `webhook` is the one
  below.
- Registration happens in the **dashboard UI only**: Pengaturan → Developer →
  Webhook. One callback URL per event type; there is no per-order or per-company
  scoping, so every event of that type POSTs to the single URL you set.
- `docs-wms.jubelio.com` is a JS SPA and returns nothing to a plain fetch, and
  `/docs-json` + `/openapi.json` are 404. `swagger.json` is the only machine-
  readable source — read it with a logged-in token.

**The one webhook endpoint that is real:**
```
POST /core-api/webhook/sales-order     "Resend Webhook Sales Order"
body: { "ids": [<salesorder_id>, …] }   # required, array of integer
```
It does not create a delivery on your own events — it re-fires the sales-order
callback for SOs you name. That makes it the *trigger* for the rig: register the
sink URL, then call this with one known SO id and read what lands.

**Event names / payload shapes are still unverified.** The table of
`/webhooks/stock|salesorder|invoice|payment|…` events and their key fields that
used to sit here came from prose docs, matched nothing in the live spec, and must
not be coded against. Field names in particular (`courier` vs `shipper`,
`is_shipped`) were wrong for the SO header, and the same guess is what this sink
exists to settle — see §9.

**A webhook may be unnecessary for the faktur question.** The invoice list read
supports filters that can answer "which of my SOs already have a faktur" in one
call, no callback required:
```
GET /core-api/sales/v2/invoices/?ids=192297
GET /core-api/sales/v2/invoices/?reffNo=FS-20261026-0001
GET /core-api/sales/v2/invoices/?is_invoiced=true&status=…&q=…&page_size=…&sort_by=…&date=…
```
(Param names as spelled in the live spec's `parameters` for that path.)

---

## 9. Resi / Tracking Number

No dedicated shipment webhook.

**Verified path — the SO header itself** (`GET /sales/orders/{id}`, live probe
2026-10-29 on SO 209 / 85 / 192297):
```
tracking_number    ← resi/AWB ("001818714258"); "" until the order ships
shipper            ← courier name, free text ("SiCepat HALU", "Grab Same Day")
tn_created_date    ← when the AWB was created
internal_status    ← PENDING → PAID → PROCESSING → SHIPPED → COMPLETED | CANCELED
```
The field name is **`shipper`**, not `courier`. ⚠ `is_shipped` and
`marked_as_complete` are `null` even on shipped and completed SOs — never gate on
them; use `internal_status` plus a non-empty `tracking_number`.

This is what the app reads and copies into `orders.tracking_number` /
`orders.shipper`, forward-only (a lower-ranked status never overwrites a higher
one, and a CANCELED SO is not written back at all).

There is no shipment webhook to fall back on (§8): the only real webhook endpoint
*resends* the sales-order callback, and it is unverified what that payload
contains. `tracking_number` on the SO header is the only read this app relies on.

**Other endpoints for shipped orders (upstream docs only, never probed here):**
```
GET  /wms/sales/shipped/             → all shipped orders + AWB
POST /wms/sales/shipments/orders/    → get AWB for specific order
```

---

## 10. Stock Reservation

For flash sale quota — optionally reserve stock separately:

```
POST /inventory/reserved/
Body: { item_id, warehouse_id, qty, ... }

GET /inventory/reserved/
GET /inventory/reserved/{id}
```

Or rely on order flow (SO creation deducts stock automatically).

---

## 11. Quick Field Reference

### Required fields per action

**Create SO:**
```
contact_id, customer_name, transaction_date, location_id,
source=1, items[], sub_total, total_disc, total_tax,
grand_total, salesorder_id=0, salesorder_no="[auto]"
+ in practice: channel_status="paid", store_id=-100, is_tax_included=false,
  payment_method (present, empty) — see §5, and the 15 item keys listed there
  rather than the upstream ones
```
The full key set is pinned by `tests/confirm-order.test.ts` →
"buildSalesOrderPayload field-set contract" (53 header keys + 15 item keys,
diffed against a captured dashboard request).

**Create Invoice:**
```
invoice_id=0, invoice_no="[auto]", customer_name,
due_date, location_id, is_opening_balance=false, items[]
```

**Create Contact:**
```
contact_id=0, contact_name, contact_type=0,
phone or mobile (at least one)
```

**Create Session Product (local only):**
```
item_id       — from Jubelio (read-only, not overridable)
sku_code      — from Jubelio
jubelioStock  — from Jubelio (read-only ref)
originalPrice — from Jubelio sell_price
sessionQuota — LOCAL override (default min(20, stock))
minOrder      — LOCAL override (default from Jubelio min field)
flashPrice    — LOCAL override (default from Jubelio sell_price)
category      — LOCAL override
```

---

## 12. Exploration Script Template

```python
import yaml

data = yaml.safe_load(open('/tmp/jubelio-openapi.yaml'))
paths = data['paths']
schemas = data['components']['schemas']

# 1. List all paths
for path, methods in sorted(paths.items()):
    for method, details in methods.items():
        print(f'{method.upper():6} {path}')

# 2. Find endpoints by keyword
KEYWORD = 'invoice'
for path, methods in paths.items():
    for method, details in methods.items():
        full = (path + method + details.get('operationId','') + details.get('summary','')).lower()
        if KEYWORD in full:
            print(f'{method.upper():6} {path}')

# 3. Inspect schema for an endpoint
OP_ID = 'postSalesOrders'
for path, methods in paths.items():
    for method, details in methods.items():
        if details.get('operationId') == OP_ID:
            req = details.get('requestBody',{}).get('content',{}).get('application/json',{})
            ref = req.get('schema',{}).get('$ref','')
            if ref:
                name = ref.replace('#/components/schemas/','')
                schema = schemas.get(name, {})
                for k, v in schema.get('properties',{}).items():
                    print(f'{k}: {v.get("type")} — {v.get("description","")[:80]}')

# 4. Check if field is required
OP_ID = 'postSalesOrders'
for path, methods in paths.items():
    for method, details in methods.items():
        if details.get('operationId') == OP_ID:
            req = details.get('requestBody',{}).get('content',{}).get('application/json',{})
            ref = req.get('schema',{}).get('$ref','')
            if ref:
                name = ref.replace('#/components/schemas/','')
                schema = schemas.get(name, {})
                print('Required:', schema.get('required', []))
```

---

## 13. Open Questions to Confirm with Jubelio

1. **Payment webhook** — the prose docs describe a `payment` event whose description says "price change", not "payment received", and no such path exists in the live spec (§8). Moot for now: payment state is driven by the create payload (§5).
2. **Invoice creation timing** — at checkout (pre-payment) or after payment confirmation?
3. **Guest checkout** — can `contact_id: 0` work for SO creation, or is a real contact required?
4. **Rate limits** — any throttle on polling endpoints?
5. **Webhook auth** — HMAC signature verification or just Bearer token? This is
   now an open *observation*, not a question: the probe sink stores every header
   verbatim except credential ones (§8, spec §4.7), so the first real delivery
   answers it. Until then the sink authenticates itself by a secret path segment
   (`JUBELIO_WEBHOOK_SINK_TOKEN`), because the dashboard gives no place to put a
   header. Our own `/api/cron/daily-sync` is guarded by the `CRON_SECRET` shared
   secret, accepted as either `x-cron-secret: <secret>` or `Authorization: Bearer
   <secret>`.
6. **Multiple warehouses** — does `location_id` matter for flash sale context?

---

## 14. Endpoints Summary Table

"Called" = exercised by this app against live Jubelio. "Documented" = appears in
the upstream OpenAPI/spec but has never been called from here.

| Action | Method | Path | Status |
|---|---|---|---|
| Auth (system account login) | POST | /login | Called |
| Product by SKU | GET | /inventory/items/by-sku/{sku} | Called |
| Stock by location | POST | /inventory/items/all-stocks/ | Called |
| Create contact | POST | /contacts/ | Called |
| Create SO | POST | /sales/orders/ | Called |
| Get SO (status + resi sync) | GET | /sales/orders/{id} | Called |
| List SOs | GET | /sales/orders/ | Called — unusable for sweeps (§5) |
| Products (all masters) | GET | /inventory/items/masters | Documented |
| Search customers | GET | /contacts/customers/ | Documented |
| Update AWB | POST | /sales/orders/save-airwaybill/ | Documented — we only read AWB, Jubelio's WMS writes it |
| Shipped orders (AWB) | GET | /wms/sales/shipped/ | Documented |
| SO → Invoice | POST | /sales/packlists/create-invoice | Documented |
| Create invoice | POST | /sales/invoices/ | Documented |
| Get invoice | GET | /sales/invoices/{id} | Documented |
| Reserve stock | POST | /inventory/reserved/ | Documented |
| Resend SO webhook | POST | /webhook/sales-order | Documented — called only to fire one event at the probe sink (§8); no production receiver |
| List invoices (faktur lookup) | GET | /sales/v2/invoices/ | Documented — supports `ids` / `reffNo` filters; the alternative to a webhook (§8) |