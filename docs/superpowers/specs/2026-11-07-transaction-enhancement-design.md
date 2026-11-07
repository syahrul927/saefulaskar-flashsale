# 2026-11-07 — Transaction UX Enhancement

## Intent

Improve transaction list scanability, add pagination, and replace native web components with shadcn throughout the flash-sale admin and customer surfaces.

## Goals

- Customer and admin transaction lists are easier to scan (no wall of items visible at once)
- Pagination for transaction lists and webhook page — cursor-based, forward-only
- Item icons show jubelio product image with letter fallback (first letter, not first character)
- Remove unused "Tipe" column from product session live table
- Replace native `<select>`, `<dialog>`, `<input type="date">` with shadcn equivalents

## Non-goals

- No feature changes beyond UX/pagination
- No backend schema changes

## Design Decisions

### Transaction list collapse

- Each order card shows summary (booking ID, status badge, date, item count, total)
- Items section shows first 2 items expanded
- If more than 2 (customer) / more than 3 (admin) items: "Lihat N item lainnya" trigger collapses/expands the rest
- Uses base `Collapsible` from `@/components/ui/collapsible` with `useState` for open/close state
- **Admin view:** shows item name + `qty × Rp` price line, no avatar (plain text list)
- **Customer view:** shows item avatar (letter tile) + name + `qty × price` line

#### Approved design (visual companion, token-corrected v2)

| Element | Treatment | Tokens |
|---|---|---|
| Expand trigger | Full-width ghost button, accent tint bg, **no orange plate** (partner ruling 2026-11-07 bans orange-filled labelled controls) | `bg-accent` + `text-accent-foreground` (#FFF1E6 / #C2410C, 4.68:1) |
| Trigger label | "Lihat N item lainnya" collapsed → "Sembunyikan" expanded, chevron rotates 180° | — |
| Expanded-state marker | Card outline ring, not orange border | `ring-1 ring-ring` (#EA580C) |
| Total strip | **Pinned outside the collapsible** — always visible in both states | `bg-muted` #F7F4F1, border `--border` |
| Item avatar | Letter tile | `bg-muted` #F7F4F1, border `--border`, text `--muted-foreground` #6F6B66 |
| Booking ID | Plain mono bold slate — **no navy chip** (matches existing cards) | `--foreground` #1F2937 |
| Card | White, warm hairline border | `--card` #FFFFFF, `--border` #EDE7E1 |
| Page ground | Warm paper | `--background` #FFFDFC |
| Animation | CSS height transition ~200ms on collapsible panel; chevron rotates; total strip never animates | — |

Admin rows show `name · qty × price` inline with subtotal right-aligned; same trigger treatment.

### Item icon — letter fallback

- Displayed via `itemInitial(item.name)` function
- Strips leading `[word] ` bracket-prefix before extracting first letter
- `"[Dus] Breast Doctor"` → `"B"` (not `"["`)
- Jubelio image: `order_item` schema has no per-line image field; first-letter fallback is the current implementation

### Cursor-based pagination

- Cursor field: `createdAt` timestamp (ISO string) for orders, `id` (UUID string) for webhooks
- Default limit: 20, max 100
- Response shape: `{ orders: [...], nextCursor: string | null, hasMore: boolean }`
- Prev/Next UI: shadcn `Pagination` / `PaginationPrevious` / `PaginationNext`
- Previous button always disabled (forward-only cursor — no stored position)
- "Reset filter" link shown when cursor is active

### Remove "Tipe" column

- Desktop product roster table: remove `<th>` header and corresponding `<td>` cell from `RosterTableRow`
- `TypeSelect` component: replaced with shadcn `Select`
- Instruction text updated: "Atur Kategori, Kuota, dan Min. Pesanan per produk." (removed "Tipe")

### Shadcn sweep

- `product-picker.tsx` `TypeSelect`: native `<select>` → shadcn `Select` / `SelectTrigger` / `SelectContent` / `SelectItem`
- Native `<select>` and `<dialog>` scanned — no other native `<select>` found in transaction-related files

## Implementation

| File | Change |
|------|--------|
| `src/app/_components/orders-list.tsx` | `itemInitial()` helper, Collapsible items in `TransactionCard` |
| `src/app/_components/admin-orders-filter.tsx` | Collapsible items in order row |
| `src/app/_components/product-picker.tsx` | Remove "Tipe" column; native `<select>` → shadcn `Select` in `TypeSelect` |
| `src/app/api/orders/route.ts` | Cursor + limit params, `nextCursor` / `hasMore` in response |
| `src/app/admin/orders/page.tsx` | Cursor + limit applied to query, Prev/Next pagination UI |
| `src/app/admin/jubelio/page.tsx` | Fixed `RECENT_LIMIT=40` → cursor-based, Prev/Next pagination UI |

## Verification Checklist

- [ ] Customer transaction list: items collapse behind "Lihat N item lainnya" trigger
- [ ] Admin transaction list: items collapse behind "Lihat N item lainnya" trigger
- [ ] Item initial: `"[Dus] Breast Doctor"` shows as `"B"`, not `"["`
- [ ] "Tipe" column gone from desktop product session table
- [ ] `TypeSelect` in product picker uses shadcn `Select` (click opens dropdown)
- [ ] Pagination: Prev/Next shown on admin orders and webhook pages
- [ ] All TypeScript passes (`pnpm exec tsc --noEmit`)
