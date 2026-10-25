# FlashStudio — Flash Sale Platform Design

**Version:** 1.1
**Date:** 2026-10-24
**Status:** Design locked — ready for plan

---

## 1. Intent & Why

Build a B2B flash sale platform for Saeful Askar Enterprise. Admin runs time-limited clearance sessions with quota-allocated products sourced from **Jubelio WMS**. Customers (resellers — business owners/PIC) browse a live catalog, checkout via bank transfer, confirm payment via WhatsApp screenshot upload. Orders sync to Jubelio as paid Sales Orders. Local Postgres mirrors everything for session control.

**Why this matters:** Manual flash sale management (WhatsApp group orders, stock confusion, no real-time quota tracking) → automate with live Jubelio stock + local quota enforcement + clean order flow.

---

## 2. Goals, Non-Goals, Anti-Goals

### Goals

- Admin creates flash sale sessions with date range (one active at a time)
- Admin picks products from **live** Jubelio catalog (search by SKU/name)
- Admin sets per-product: `sessionQuota`, `minOrder`, `flashPrice`, `category` (manual)
- Customer sees live catalog with countdown timer, quota bar, category filter
- Customer adds to cart (MOQ floor enforced, no per-customer ceiling)
- **Oversell guard**: live stock check at CO — block if insufficient
- Customer checkout → local booking (status: UNPAID, no Jubelio SO yet)
- Customer shown bank account options from `.env`
- Customer transfers → clicks "Kirim Bukti Transfer" → WhatsApp opens with pre-filled text + screenshot attachment
- Admin verifies booking + screenshot → clicks "Konfirmasi Bayar"
- App creates Jubelio SO with `is_paid: true` → immediately "Ready to Ship" (no UNPAID phase)
- Daily polling syncs SHIPPED/Completed from Jubelio
- Customer views order history: UNPAID / CONFIRMED / SHIPPED / Completed

### Non-Goals

- Real payment gateway (VA, payment API integration)
- Webhooks in v1 — daily polling only
- Multi-warehouse support — single `JUBELIO_LOCATION_ID` from `.env`
- Guest checkout — Google login required for customers

### Anti-Goals (What Would Make This a Failure)

- Order placed with stock that no longer exists in Jubelio (oversell)
- Jubelio SO created before payment confirmed (ghost orders)
- WhatsApp proof goes to wrong number or wrong pre-filled text (customer confused)
- Session created with date overlap (double-booking)
- Admin starts new session while another is PAUSED (PAUSED = "in use", must END first)

### Stock Release on Cancel

`claimed` is local quota counter only. At CO: `claimed += qty`. No Jubelio SO created yet = no stock deducted in Jubelio. Admin cancels order in app → `claimed -= qty` (released). No auto-timeout release — admin must manually cancel stale UNPAID orders.

---

## 3. Constraints

| Constraint | Detail |
|---|---|
| **Auth — Customer** | Google OAuth → `POST /core-api/contacts/` to register in Jubelio |
| **Auth — Admin** | Jubelio email/password login → local `user` row, role forced `OWNER` |
| **Jubelio API** | Base: `https://open.jubelio.com/core-api/` — docs unreliable, test per endpoint |
| **Payment** | Bank transfer only. WhatsApp proof upload. No real payment gateway. |
| **Bank accounts** | Defined in `.env` as `BANK_ACCOUNTS` JSON array |
| **WhatsApp** | Number from `.env` (`WHATSAPP_NUMBER`). Text template: see Section 5. |
| **DB** | Local Postgres via Drizzle ORM (already in stack) |
| **Framework** | Next.js 15 + TypeScript + shadcn/ui + Tailwind |
| **Mobile** | Responsive, touch-friendly. Mobile bottom action bar on customer storefront. All screens work on 375px+. |
| **Session rule** | One active at a time — date conflict check on create/activate |
| **Location** | Single `JUBELIO_LOCATION_ID` in `.env` (no multi-warehouse) |

---

## 4. What Was Decided (Locked — Builder Implements As Specified)

### 4.1 Customer Onboarding (Google Login)

**Flow:**
1. Customer clicks "Login with Google" → OAuth → receives JWT
2. App checks if `contact_id` exists locally for this Google email
   - If yes → proceed
   - If no → show onboarding form to collect required fields, then `POST /core-api/contacts/`

**Onboarding form fields** (maps to `saveContactRequest`):
| Form field | Jubelio API field |
|---|---|
| Nama toko/perusahaan | `contact_name` |
| Nama PIC | `primary_contact` |
| Jabatan | `contact_position` ('pemilik' or 'procurement', dropdown) |
| No. Telf PIC | `phone` |
| Alamat lengkap | `s_address` |

**API call:**
```
POST /core-api/contacts/
{
  "contact_id": 0,
  "contact_name": "...",       // company/store name
  "contact_type": 0,           // Customer
  "primary_contact": "...",    // PIC name
  "contact_position": "...",   // 'pemilik' | 'procurement'
  "phone": "...",
  "s_address": "...",
  "is_reseller": true
}
```

**Response:** `{ contact_id: <number> }` → store in local `contacts` table. Future checkouts reuse this `contact_id`.

---

### 4.2 Session Management (Admin)

**Session entity fields:**
```
id, name, start_time, end_time, status (SCHEDULED/ACTIVE/PAUSED/ENDED), created_at
```

**Status rules:**
- `SCHEDULED` → admin can edit all fields; can be activated if no conflict
- `ACTIVE` → admin can change status to PAUSED or ENDED only
- `PAUSED` → admin can resume to ACTIVE or ENDED; **blocks new session creation** (cannot activate new session while another is PAUSED — must END first)
- `ENDED` → terminal

**Date conflict:** If `start_time`/`end_time` overlaps with an existing `SCHEDULED` or `ACTIVE` session → reject with error.

**Drop session:** Admin can immediately set status to ENDED (no confirmation dialog).

---

### 4.3 Session Products (Admin Picks Products)

**Live fetch from Jubelio at pick time:**
- `GET /core-api/inventory/items/masters` — browse/search all products
- `POST /core-api/inventory/items/all-stocks/` with `location_id` — all products + stock per warehouse

**Admin sets per product (stored locally):**
```
session_id, item_id, sku_code, item_group_name,
jubelio_stock (readonly ref), original_price (readonly ref),
session_quota (admin override, default: min(20, stock)),
min_order (admin override, default: from Jubelio min field),
flash_price (admin override, default: original_price),
category (admin manual input)
```

**Note:** `item_id` and `sku_code` are read from Jubelio and not overridable. Admin overrides stored locally only — no push to Jubelio.

**Category:** Manual string input by admin. Not fetched from Jubelio `item_category_id`.

---

### 4.4 Customer Storefront

**Catalog:**
- Show all ACTIVE sessions' products
- Countdown timer to session end
- Quota bar: `claimed / session_quota`
- Category pill filter buttons (from admin-defined categories)
- Sold-out overlay when `claimed >= session_quota`

**Cart:**
- Add to cart at `min_order` qty default
- Increment/decrement — MOQ floor enforced, no ceiling
- Quick buy button: add at MOQ + open cart

**Checkout (CO):**
1. Check stored stock per item — `session_products.jubelio_stock` (snapshot taken at pick time). Customers hold no Jubelio account, so there is **no live stock fetch at CO**; if `jubelio_stock < requestedQty` → block CO, show "Stock tidak mencukupi"
2. Check: `claimed + requestedQty <= session_quota` for each item
   - If exceeded → block CO, show "Quota exceeded"
3. Create local `orders` row:
   - `booking_id` = local order number (see Section 5 for format)
   - `status: UNPAID`
   - `grand_total`, `items`, `customer_id`
4. Show bank account options + "Kirim Bukti Transfer" button

---

### 4.5 Payment Flow — Booking to SO

**Phase 1 — Booking (local only):**
```
Customer checkout
  → local orders row (UNPAID, booking_id)
  → shown bank accounts (.env BANK_ACCOUNTS)
  → customer transfers
  → clicks "Kirim Bukti Transfer"
  → WhatsApp opens: wa.me/{WHATSAPP_NUMBER}?text={template}
  → customer attaches screenshot, sends
```

**Phase 2 — Confirmation (creates Jubelio SO):**
```
Admin dashboard: list UNPAID bookings
  → shows booking_id, amount, transfer screenshot
  → admin verifies screenshot + amount against bank statement
  → clicks "Konfirmasi Bayar"
  → POST /core-api/sales/orders/ with is_paid: true
  → local order status → CONFIRMED
  → daily poll: SHIPPED → Completed
```

**Jubelio SO creation fields:**
```
salesorder_id: 0
salesorder_no: "[auto]"
contact_id: <from contacts table>
customer_name: <from contacts.contact_name>
transaction_date: <today ISO>
location_id: <JUBELIO_LOCATION_ID from .env>
source: 1
is_paid: true
payment_method: "transfer"
items: [...]
sub_total, total_disc, total_tax, grand_total
add_disc: 0
add_fee: 0
service_fee: 0
```

**Jubelio status result:** "Ready to Ship" immediately (no UNPAID/CONFIRMED phase).

**Status mapping:**
| Local | Jubelio |
|---|---|
| UNPAID (booking) | *(no SO yet)* |
| CONFIRMED | Ready to Ship |
| SHIPPED | Shipped |
| Completed | Completed |

---

### 4.6 Daily Sync

**Cron job** (platform TBD — Vercel cron or `node-cron`):
```
GET /core-api/sales/orders/
  → for each order where jubelio_so_id is set:
    → compare status → update local if changed
GET /core-api/sales/invoices/
  → mirror to local invoices table
```

**Completed trigger:** when local status = SHIPPED and `order_status = "Completed"` from Jubelio → update to Completed.

---

## 5. Builder's Calls (Sensible Defaults Applied — Confirm If Wrong)

These are things the builder settles without asking, listed here for visibility:

1. **Booking ID format:** `FS-{YYYYMMDD}-{SEQ4}` e.g. `FS-20261023-0001`. Incrementing sequence per day. ✅ Confirmed via UI mockup.

2. **WhatsApp pre-filled text template:** ✅ Confirmed via UI mockup — format:
   ```
   "Halo, saya sudah transfer untuk pesanan {booking_id} sejumlah Rp{grand_total} ke rekening {bank_name} {account_number} atas nama {account_name}. Bukti transfer terlampir."
   ```
   The button opens: `wa.me/{WHATSAPP_NUMBER}?text=<encoded template>`

3. **Database schema (Drizzle):**
   - `contacts`: `id, google_id, email, jubelio_contact_id, contact_name, primary_contact, contact_position, phone, s_address, created_at`
   - `flash_sessions`: `id, name, start_time, end_time, status, created_at`
   - `session_products`: `id, session_id, item_id, sku_code, item_group_name, jubelio_stock, original_price, session_quota, claimed, min_order, flash_price, category`
   - `orders`: `id, booking_id, customer_id, session_id, status, grand_total, payment_method, transfer_proof_url, jubelio_so_id, created_at, updated_at`
   - `order_items`: `id, order_id, session_product_id, item_id, sku, item_name, qty, price, subtotal`

4. **Transfer proof upload:** Local file storage (`/public/uploads`) for v1. Image URL stored in `orders.transfer_proof_url`. (Cloud storage can be added later.)

5. **Cron job:** Vercel cron (`/api/cron/daily-sync`) — daily at midnight UTC. Protected by `CRON_SECRET` header.

6. **Google OAuth:** better-auth `socialProviders.google`, registered only when `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are set. Google sign-in creates a local `user` with role `CUSTOMER`.

7. **Jubelio tokens:** No static token. Admin/user routes use the logged-in user's Jubelio token (issued at login); system routes with no logged-in user (cron, contact registration) log in with `JUBELIO_SYSTEM_EMAIL`/`JUBELIO_SYSTEM_PASSWORD` to mint a token. A 401 on a user route means the Jubelio session ended → sign out.

8. **Error handling at CO:**
   - If Jubelio stock fetch fails → block CO, show "Gagal cek stok, coba lagi"
   - If Jubelio SO creation fails after payment confirmed → alert admin, local stays CONFIRMED, retry job

9. **Admin session edit after ACTIVE:** No fields editable once session is ACTIVE (config frozen). Only status change (PAUSE/END).

10. **Category filter (customer):** Category pills on storefront filter products by `session_products.category`. "All" pill always shown.

11. **Mobile bottom bar (customer):** Fixed bottom bar on mobile showing cart subtotal + "View Cart (n)" button. Disappears when cart empty. Shadcn mobile-first classes.

12. **No payment countdown timer:** Unlike the prototype in design.html, there is NO 15-minute payment hold or countdown. Stock is claimed at CO (local `claimed` incremented), not released on timeout.

13. **Cart summary (clean):** No "Express Delivery" or "Flash Session Discount" lines. Cart shows: Subtotal, Total Checkout only. Display savings as struck-through original price on product card.

---

## 6. What Needs to Be Configured Before Launch

These are variables the human must fill in `.env`:

```env
# Jubelio — no static token: admin routes use the user's login token,
# system routes log in with the default account below.
JUBELIO_SYSTEM_EMAIL=<system/default Jubelio account email>
JUBELIO_SYSTEM_PASSWORD=<system/default Jubelio account password>
JUBELIO_LOCATION_ID=<from GET /core-api/locations/ — your warehouse ID>
JUBELIO_BASE_URL=https://open.jubelio.com/core-api/

# Google OAuth (customer login)
GOOGLE_CLIENT_ID=<from Google Cloud Console>
GOOGLE_CLIENT_SECRET=<from Google Cloud Console>

# WhatsApp
WHATSAPP_NUMBER=<wa.me/628xxx without + prefix>

# Bank accounts (JSON array)
BANK_ACCOUNTS=[{"bank":"BCA","account_number":"...","account_name":"..."},{"bank":"Mandiri","account_number":"...","account_name":"..."}]

# App (Better Auth)
BETTER_AUTH_SECRET=<existing>

# Cron
CRON_SECRET=<random secret for cron endpoint protection>
```

---

## 7. Key Files to Build

### Backend (API Routes)

| Route | Purpose |
|---|---|
| `POST /api/contacts/` | Create contact in Jubelio, store locally |
| `GET /api/jubelio/products` | Live fetch from Jubelio for admin picker |
| `POST /api/jubelio/stock` | Get stock for CO guard |
| `POST /api/orders/` | Create local booking (checkout) |
| `POST /api/orders/[id]/confirm` | Admin confirms payment → creates SO in Jubelio |
| `GET /api/orders/` | List orders (customer: own, admin: all UNPAID) |
| `GET /api/orders/[id]` | Order detail |
| `POST /api/orders/[id]/upload-proof` | Upload transfer screenshot |
| `GET /api/sessions/` | List sessions (customer: active only, admin: all) |
| `POST /api/sessions/` | Create session (admin) |
| `PATCH /api/sessions/[id]` | Update session (admin, SCHEDULED only) |
| `POST /api/sessions/[id]/activate` | Set status ACTIVE, check date conflict |
| `POST /api/sessions/[id]/end` | Set status ENDED |
| `POST /api/cron/daily-sync` | Daily polling (cron-protected) |

### Frontend Pages

| Page | Access |
|---|---|
| `/` | Customer storefront — live catalog, cart, checkout |
| `/orders` | Customer order history |
| `/auth/login` | Existing login page |
| `/onboarding` | New customer — complete profile form (post-Google-login) |
| `/admin` | Admin dashboard — sessions list |
| `/admin/sessions/new` | Create/edit session (admin) |
| `/admin/sessions/[id]/products` | Product picker (admin) |
| `/admin/orders` | Pending confirmations (admin) — UNPAID bookings with proof |

---

## 8. Open Questions (Humans Must Answer Before Build)

| # | Question | Impact | Status |
|---|---|---|---|
| A | WhatsApp pre-filled text template | ✅ Resolved — confirmed in UI mockup | DONE |
| B | Transfer proof screenshot — max file size / format | Builder settles: accept JPEG/PNG, 5MB max | Minor |
| C | Session product `session_quota` default | Builder settles: `min(20, stock)` default, editable per session | Minor |
| D | After session ENDs — can customer see order history? | Yes — orders always visible, session filter optional | DONE |
| E | PAUSED session — can admin start another? | ✅ Resolved — NO, PAUSED blocks (must END first) | DONE |
