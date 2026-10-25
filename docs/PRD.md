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
payment_method   : "transfer"       (bank transfer)
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
courier, note, ref_no, channel_status
```

**Response:** `{ id: <salesorder_id> }`

> **Note:** `is_paid: true` + `payment_method: "transfer"` marks the order as paid at creation — no UNPAID phase. Status transitions (CONFIRMED → SHIPPED → Completed) handled by Jubelio internally + synced back via webhooks.

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

Four webhooks available — registered via `POST /webhooks/{type}`:

| Webhook | Trigger | Action in our system |
|---|---|---|
| `invoice` | Invoice created/updated | Sync invoice status |
| `salesorder` | Order created/changed (e.g. status transitions) | Sync order status |
| `stock` | Stock change (orders, transfers, returns) | Update available quota |
| `payment` | Price change (⚠ see note) | **Not used** — payment confirmed via WhatsApp |

> **Note:** `payment` webhook describes price change, not payment received. Payment confirmation done via WhatsApp proof upload → admin creates SO with `is_paid: true`. Jubelio immediately sets status to **Ready to Ship** — no UNPAID or CONFIRMED phase in Jubelio. The `salesorder` webhook fires with `status: "Ready to Ship"`, which maps to local status **CONFIRMED**.

Webhook payload fields available (from schema):
- `invoice_id`, `invoice_no`, `contact_id`, `customer_name`, `transaction_date`, `due_date`, `grand_total`, `status`
- `order_id`, `order_no`, `order_status`, `payment_status`, `tracking_number`, `courier`, `is_shipped`, `wms_status`

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
| Orders | **Polling + save to DB** | Daily scheduler (for Completed status) |
| Sales Orders | **Polling + save to DB** | Daily scheduler |
| Invoices | **Polling + save to DB** | Daily scheduler |
| Stock changes | **Webhook** (`/webhooks/stock`) | Real-time quota update after orders/returns |
| Order status | **Webhook** (`/webhooks/salesorder`) | Real-time status update |

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

**Transaction is Completed when** Jubelio `status = "Completed"`.

**Jubelio internal status → local status mapping:**
| Jubelio | Local |
|---|---|
| *(no SO yet)* | UNPAID (booking) |
| Ready to Ship | CONFIRMED |
| Shipped | SHIPPED |
| Completed | Completed |

Save to local DB on every sync. Webhook handles urgent events (stock, order status transitions) as backup.

### 4.3 Resi / AWB Tracking

No dedicated shipment webhook. Use **`/webhooks/salesorder`** — fires on order status changes.

Webhook fields:
```
tracking_number    ← resi/AWB number
courier           ← courier name
is_shipped        ← "yes" when shipped
wms_status        ← WMS fulfillment status
```

Handler: watch for `tracking_number` empty → filled transition. Update local `orders.tracking_number`, `orders.courier`, `orders.shipped_at`.

**Backup polling:**
```
GET /wms/sales/shipped/             → all shipped orders + AWB
GET /sales/orders/{id}             → single order
POST /wms/sales/shipments/orders/   → get AWB for specific order
```

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
7. App creates SO in Jubelio with `is_paid: true`, `payment_method: "transfer"` → **instant paid** (no UNPAID phase)
8. Local order status → **CONFIRMED**
9. Daily sync → SHIPPED → Completed (via webhooks as backup)

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

### Customer

- **CS-01** — Login with Google → auto-create contact in Jubelio → stored locally
- **CS-02** — View live flash deals catalog with countdown timer
- **CS-03** — Filter by category (admin-defined tags)
- **CS-04** — See quota bar (claimed/total) per product; sold-out overlay when exhausted
- **CS-05** — Add to cart (starts at MOQ qty), increment/decrement with MOQ floor enforced
- **CS-06** — Quick buy (add + open cart)
- **CS-07** — Checkout: enter/confirm address, select bank transfer account
- **CS-08** — See order in Transaction History with status badge (UNPAID / CONFIRMED / SHIPPED / Completed)
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
| 6 | Stock sync strategy | **Resolved** — live fetch at session setup + at CO; webhook as real-time backup |
| 7 | Order Completed trigger | **Resolved** — when `order_status = "Completed"` in Jubelio |
| 8 | Polling interval for daily sync | **Pending** — propose: daily at midnight + manual trigger |
| 9 | `location_id` — how to map to our warehouse | **Needs Jubelio** — query `/locations/` |
| 10 | Stock reservation (pre-allocate vs. on-order) | **TBD** — may use `/inventory/reserved/` for flash sale quota |
| 11 | Webhook secret/authentication | Need to implement HMAC verification |
| 12 | WhatsApp link format | **Pending** — wa.me/ number + pre-filled text template |
| 13 | API base URL | **Resolved** — use `https://open.jubelio.com/core-api/` (new domain); old `api2.jubelio.com` possibly deprecated |
| 14 | API docs reliability | **Known issue** — docs not 100% valid. Some endpoints moved/deprecated. Need trial & error per endpoint. |
| 15 | `location_id` — Jubelio | **Resolved** — `GET /core-api/locations/` works on new domain. Set in `.env` as `JUBELIO_LOCATION_ID`. |

---

## 7. API Quick Reference

### Auth
```
POST /login   → { access_token }   (12h expiry)
Authorization: Bearer <token>
```

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

### Webhooks (register via POST)
```
POST /webhooks/invoice      → invoice events
POST /webhooks/salesorder   → order status events
POST /webhooks/stock        → stock change events
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

---

## 9. Non-Functional

- **Session data**: stored locally, not in Jubelio
- **Offline resilience**: storefront works against local session_products if Jubelio unreachable (read-only product data cached)
- **Quota enforcement**: local `claimed` counter managed in-app, Jubelio stock checked live at CO
- **Oversell guard**: re-fetch stock before CO — block if insufficient
- **Payment simulation**: not needed — real transfer flow via WhatsApp proof in v1
