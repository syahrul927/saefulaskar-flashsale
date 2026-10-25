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
/webhooks/*      — Webhook registration (POST to register)
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
items[]          : [
  { item_id, item_name, sku, qty, price, discount, tax, uom_id, warehouse_id }
]
sub_total, total_disc, total_tax, grand_total
```

**Get SO:**
```
GET /sales/orders/           → all
GET /sales/orders/{id}       → by ID
GET /wms/sales/shipped/      → shipped orders (has tracking_number)
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

Register via `POST /systemsetting/webhook` with the event type.

Available webhooks:

| Webhook | Fires When | Use For |
|---|---|---|
| `/webhooks/stock` | Stock changes (orders, transfers, returns) | Live quota update |
| `/webhooks/salesorder` | Order created/status changed | Order status sync |
| `/webhooks/invoice` | Invoice created/updated | Invoice sync |
| `/webhooks/payment` | ⚠ "price change" — NOT payment received | TBD / verify with Jubelio |
| `/webhooks/product` | Product created/updated | Product catalog sync |
| `/webhooks/salesreturn` | Sales return created | Return handling |
| `/webhooks/adjustment` | Stock adjustment done | Audit trail |
| `/webhooks/stocktransfer` | Stock transfer created | Transfer sync |

**`salesorder` webhook — key fields:**
```
salesorder_id, salesorder_no
status, is_shipped
tracking_number   ← resi/AWB
courier           ← courier name
is_paid
contact_id
grand_total
items[]
```

**`webhookInvoice` — key fields:**
```
invoice_id, invoice_no
contact_id, customer_name
grand_total
status
```

---

## 9. Resi / Tracking Number

No dedicated shipment webhook.

**Use `/webhooks/salesorder`** — fires when AWB assigned (order packed → handed to courier). Payload has:
```
tracking_number
courier
is_shipped
```

**Backup polling for history:**
```
GET /wms/sales/shipped/              → all shipped orders + AWB
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
```

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

1. **Payment webhook** — description says "price change", not "payment received". Clarify what events it actually fires.
2. **Invoice creation timing** — at checkout (pre-payment) or after payment confirmation?
3. **Guest checkout** — can `contact_id: 0` work for SO creation, or is a real contact required?
4. **Rate limits** — any throttle on polling endpoints?
5. **Webhook auth** — HMAC signature verification or just Bearer token?
6. **Multiple warehouses** — does `location_id` matter for flash sale context?

---

## 14. Endpoints Summary Table

| Action | Method | Path |
|---|---|---|
| Auth | POST | /login |
| Products (all) | GET | /inventory/items/masters |
| Product by SKU | GET | /inventory/items/by-sku/{sku} |
| Stock by location | POST | /inventory/items/all-stocks/ |
| Create contact | POST | /contacts/ |
| Search customers | GET | /contacts/customers/ |
| Create SO | POST | /sales/orders/ |
| Get SO | GET | /sales/orders/{id} |
| Update AWB | POST | /sales/orders/save-airwaybill/ |
| Shipped orders (AWB) | GET | /wms/sales/shipped/ |
| SO → Invoice | POST | /sales/packlists/create-invoice |
| Create invoice | POST | /sales/invoices/ |
| Get invoice | GET | /sales/invoices/{id} |
| Reserve stock | POST | /inventory/reserved/ |
| Webhook: stock | POST | /webhooks/stock |
| Webhook: order | POST | /webhooks/salesorder |
| Webhook: invoice | POST | /webhooks/invoice |
| Webhook: shipment (via order) | — | /webhooks/salesorder |