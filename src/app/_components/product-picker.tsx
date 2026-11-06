"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  EyeIcon,
  EyeSlashIcon,
  FloppyDiskIcon,
  MagnifyingGlassIcon,
  PackageIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { cn } from "cn";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Panel } from "@/app/_components/panel";
import { categoryOptions } from "@/app/_components/category-options";
import { StatusBadge } from "@/app/_components/status-badge";
import { useDebouncedValue } from "@/app/_components/use-debounced-value";
import { useSessionExpiry } from "@/app/_components/use-session-expiry";
import { canEditProducts } from "@/server/session-products-edit";
import { formatRupiah } from "@/lib/format";
import {
  PRODUCT_TYPES,
  PRODUCT_TYPE_LABELS,
  type ProductType,
} from "@/server/db/schema";

export type SessionProduct = {
  id: string;
  itemId: number;
  skuCode: string | null;
  itemGroupName: string | null;
  originalPrice: number;
  sessionQuota: number;
  claimed: number;
  minOrder: number;
  flashPrice: number;
  category: string | null;
  type: ProductType;
  /**
   * Mid-session removal flag (Task 2/4): a hidden row is gone from the
   * storefront but stays in the roster, muted, with a re-show control. The
   * admin list GET and the roster page join carry it on every row.
   */
  hidden: boolean;
  /**
   * v2 thumbnail URL, joined live from the stock map on the roster page
   * (`rosterProducts`) and preserved by the picker's add/save merges.
   * Missing data (null/absent) renders the mockup D6 letter tile instead.
   */
  image?: string | null;
  /** Raw ERP stock from the same live v2 join; `null` renders "—". */
  availableStock: number | null;
};

/** Mirrors `PickerRow` from `/api/jubelio/products` (route `toPickerRows`). */
export type SearchResult = {
  itemId: number;
  skuCode: string;
  itemGroupName: string;
  /** Normal (catalog) price — rendered struck in the picker rows. */
  price: number;
  minOrder: number;
  /**
   * ERP availability per SKU, merged server-side from the v2 inventory
   * cache (`mergeStockIntoRows`). Raw parity: negative figures (live min
   * −14) display untouched; `null` means the SKU is absent from the v2
   * payload and renders `—`.
   */
  stock: number | null;
  /** v2 `thumbnail` URL; `null` → letter tile (`SearchThumb`). */
  image: string | null;
};

/**
 * Client-side catalog filter — the upstream masters endpoint rejects every
 * query param (spec probe 2026-10-26), so search matches name/SKU
 * substrings locally against the cached full catalog. Case-insensitive,
 * whitespace-trimmed; empty query returns the whole list. Results are capped
 * (`cap = 100`) because the dialog renders plain divs, not a virtualized
 * list. Exported for unit tests.
 */
export function filterCatalog(
  rows: SearchResult[],
  query: string,
  cap = 100,
): SearchResult[] {
  const q = query.trim().toLowerCase();
  const matched =
    q === ""
      ? rows
      : rows.filter(
          (r) =>
            r.itemGroupName.toLowerCase().includes(q) ||
            r.skuCode.toLowerCase().includes(q),
        );
  return matched.slice(0, cap);
}

/**
 * The catalog-fetch guard, as a pure predicate (final review C-1). The old
 * effect re-ran on every `loadingCatalog` flip; after a failure `catalog`
 * stayed null and the guard passed again — one request per round trip in a
 * loop, a toast storm, and hammering the ERP with the admin's token. The
 * `errored` term is the stop: a failed load is retried only by closing and
 * reopening the dialog, exactly what the error plate says.
 * Exported for unit tests.
 */
export function shouldLoadCatalog({
  open,
  loaded,
  inFlight,
  errored,
}: {
  open: boolean;
  loaded: boolean;
  inFlight: boolean;
  errored: boolean;
}): boolean {
  return open && !loaded && !inFlight && !errored;
}

/**
 * PUT body for one roster row — only the fields that actually changed are
 * sent (partial updates are the route's contract; "minimal satu field"
 * fails an empty body, so callers only send rows with at least one diff).
 */
type RowPatchBody = {
  sessionQuota?: number;
  minOrder?: number;
  flashPrice?: number;
  /** `null` = "Umum" (uncategorised); mirrors the nullable DB column. */
  category?: string | null;
  type?: ProductType;
  hidden?: boolean;
};

/** Shared class strings for the inline-edit cells (design.html:297-335). */
const cellSelectClass =
  "rounded-lg border border-neutral-200 bg-neutral-50 px-2 py-1 text-xs text-neutral-800 focus:border-brand-primary focus:outline-none dark:border-border dark:bg-input/30 dark:text-neutral-200";
const cellInputClass =
  "rounded-lg border border-neutral-200 bg-neutral-50 px-2 py-1 font-mono text-xs font-bold text-neutral-950 focus:border-brand-primary focus:outline-none dark:border-border dark:bg-input/30 dark:text-neutral-50";
/** MOQ cell's brand tint — decoration (this row is special, not wrong). No
 * `dark:` pair: an admin table cell paints on paper only, and `.dark` is unreachable. */
const cellInputBrandClass =
  "rounded-lg border border-brand-primary/30 bg-brand-primary/10 px-2 py-1 font-mono text-xs font-black text-brand-action focus:border-brand-mark focus:outline-none";
const readOnlyCellClass =
  "font-mono text-xs text-neutral-800 dark:text-neutral-200";

function productLabel(product: SessionProduct) {
  return (
    product.itemGroupName ?? product.skuCode ?? `Item #${product.itemId}`
  );
}

/**
 * Read-only category cell text: null AND legacy `""` both display as
 * "Umum" (storefront D-rule; POST-imported rows store `""`).
 */
function categoryText(category: string | null): string {
  return category === null || category.trim() === "" ? "Umum" : category;
}

/**
 * Roster thumb: the live v2 image when the join has one, else the mockup D6
 * letter tile as the missing-data fallback.
 */
function RosterThumb({
  product,
  size = "table",
}: {
  product: SessionProduct;
  size?: "table" | "card";
}) {
  const frame =
    size === "table"
      ? "h-10 w-10 rounded-lg"
      : "h-12 w-12 rounded-xl";
  const letter = size === "table" ? "text-base" : "text-lg";
  if (product.image) {
    return (
      // Brief pins plain <img class="object-cover">; no next/image config
      // exists for external Jubelio CDN hosts yet.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={product.image}
        alt=""
        className={`${frame} shrink-0 border border-neutral-200 bg-neutral-100 object-cover dark:border-border`}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center ${frame} bg-gradient-to-br from-brand-primary/10 to-brand-secondary/15`}
    >
      <span className={`${letter} font-black text-brand-action`}>
        {productLabel(product).charAt(0).toUpperCase()}
      </span>
    </span>
  );
}

/**
 * Search-row thumb: real v2 thumbnail when present, otherwise the mockup D6
 * letter tile. Same <img>-else-tile idiom as `RosterThumb`, sized to the
 * picker row's 44px frame.
 */
function SearchThumb({
  image,
  label,
}: {
  image: string | null;
  label: string;
}) {
  if (image) {
    return (
      // Plain <img>: no next/image config for external Jubelio CDN hosts yet.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={image}
        alt=""
        className="h-11 w-11 shrink-0 rounded-lg border border-neutral-200 bg-neutral-100 object-cover dark:border-border"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-primary/10 to-brand-secondary/15"
    >
      <span className="text-base font-black text-brand-action">
        {label.charAt(0).toUpperCase()}
      </span>
    </span>
  );
}

/** Parse a numeric draft; empty/NaN/decimal junk yields `null`. */
function parseDraft(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

/**
 * Guard for the per-row Simpan button: every visible numeric draft must be a
 * finite integer within range before anything is sent. Emptying a cell must
 * never POST `Number("") === 0` against the route's positive-int schema —
 * the button just stays disabled until the draft is valid again.
 */
function canSaveRow(drafts: {
  quota: string;
  minOrder: string;
  flashPrice: string;
}): boolean {
  const quota = parseDraft(drafts.quota);
  const minOrder = parseDraft(drafts.minOrder);
  const flashPrice = parseDraft(drafts.flashPrice);
  return (
    quota !== null &&
    quota >= 1 &&
    minOrder !== null &&
    minOrder >= 1 &&
    flashPrice !== null &&
    flashPrice >= 0
  );
}

/**
 * Guard for the search rows' `+ Tambah` button (Task 8): a product the ERP
 * reports as zero stock must not enter a session — it could never sell.
 * Unknown stock (`null`, rendered "—") stays addable: unknown ≠ zero, the
 * v2 map simply had no row for it.
 */
function canAddRow(stock: number | null): boolean {
  return stock !== 0;
}

/**
 * One roster row's unsaved edit values (the Save-bar draft model). The three
 * numeric fields stay strings so a cleared/typing cell is representable;
 * `dirtyPatches` parses them and compares against the saved row.
 */
type RowDraft = {
  quota: string;
  minOrder: string;
  flashPrice: string;
  /** "" renders as "Umum"; the flush maps it back to `category: null`. */
  category: string;
  type: ProductType;
};

/** A draft that equals the row as saved — the starting value until edited. */
function defaultDraft(product: SessionProduct): RowDraft {
  return {
    quota: String(product.sessionQuota),
    minOrder: String(product.minOrder),
    flashPrice: String(product.flashPrice),
    category: product.category ?? "",
    type: product.type,
  };
}

/**
 * The dirty-row → PUT-body derivation for the single Save bar (Task 7):
 * one entry per row with at least one PARSEABLE numeric draft field that
 * differs from the saved value. Untouched rows (no draft entry) are absent;
 * an equal draft is absent ("50" === 50); empty or unparsable cells are
 * skipped silently — a half-typed row must never send `Number("") === 0`,
 * and the Save button itself stays blocked by the `canSaveRow` guard until
 * every draft parses again. Exported for unit tests.
 */
export function dirtyPatches(
  products: readonly SessionProduct[],
  drafts: ReadonlyMap<
    number,
    { quota: string; minOrder: string; flashPrice: string }
  >,
): Array<{
  itemId: number;
  patch: { sessionQuota?: number; minOrder?: number; flashPrice?: number };
}> {
  const out: Array<{
    itemId: number;
    patch: { sessionQuota?: number; minOrder?: number; flashPrice?: number };
  }> = [];
  for (const product of products) {
    const draft = drafts.get(product.itemId);
    if (!draft) continue;
    const patch: {
      sessionQuota?: number;
      minOrder?: number;
      flashPrice?: number;
    } = {};
    const quota = parseDraft(draft.quota);
    if (quota !== null && quota !== product.sessionQuota) {
      patch.sessionQuota = quota;
    }
    const minOrder = parseDraft(draft.minOrder);
    if (minOrder !== null && minOrder !== product.minOrder) {
      patch.minOrder = minOrder;
    }
    const flashPrice = parseDraft(draft.flashPrice);
    if (flashPrice !== null && flashPrice !== product.flashPrice) {
      patch.flashPrice = flashPrice;
    }
    if (Object.keys(patch).length > 0) {
      out.push({ itemId: product.itemId, patch });
    }
  }
  return out;
}

/**
 * Which Jubelio item ids already sit in the roster. The picker modal keys its
 * `+ Tambah` ↔ `✓ Ditambah` toggle and its `N dipilih` counter off this set —
 * selection lives on the roster (by `itemId`), so it survives any re-query.
 */
function selectedItemIds(
  products: readonly { itemId: number }[],
): Set<number> {
  return new Set(products.map((p) => p.itemId));
}

/**
 * Merge freshly added/updated products into the roster keyed by `itemId`:
 * existing rows are replaced in place, new rows append. Re-POSTing the same
 * item never duplicates a roster row.
 *
 * POST/PUT answer with raw drizzle rows that carry neither `image` nor the
 * computed `availableStock` (both are v2-map joins done on GET), so a plain
 * replace would revert a row's thumbnail to a letter tile and its stock to
 * `—` until the next reload. Live fields survive the merge instead: the
 * picked catalog row (`live`, what the admin just saw) wins, then the row
 * being replaced, else `null` renders the letter-tile/`—` fallbacks.
 */
function mergeProductsById(
  prev: readonly SessionProduct[],
  incoming: readonly SessionProduct[],
  live: readonly SearchResult[] = [],
): SessionProduct[] {
  const liveByItem = new Map(live.map((r) => [r.itemId, r]));
  const next = [...prev];
  for (const p of incoming) {
    const idx = next.findIndex((x) => x.itemId === p.itemId);
    const existing = idx === -1 ? undefined : next[idx];
    const patch = liveByItem.get(p.itemId);
    const row: SessionProduct = {
      ...p,
      image: p.image ?? patch?.image ?? existing?.image ?? null,
      availableStock:
        p.availableStock ?? patch?.stock ?? existing?.availableStock ?? null,
    };
    if (idx === -1) next.push(row);
    else next[idx] = row;
  }
  return next;
}

/**
 * Per-row edit plumbing, shared by the desktop table row and the mobile card
 * (Review Focus 4: `canEdit === false` renders no controls at all). Task 7
 * moved draft ownership up to `ProductPicker` — the row reports every edit
 * through `onDraftChange` and the roster's single Save bar flushes them;
 * this hook keeps only the remove action's own loading state.
 */
function useRowEdit({
  product,
  canEdit,
  draft,
  onDraftChange,
  onRemove,
  busy,
}: {
  product: SessionProduct;
  canEdit: boolean;
  draft: RowDraft;
  onDraftChange: (itemId: number, next: RowDraft) => void;
  onRemove: (itemId: number) => Promise<void>;
  /** Another request touches this row (hide in flight / batch save). */
  busy: boolean;
}) {
  const [removing, setRemoving] = useState(false);

  function setDraft(patch: Partial<RowDraft>) {
    onDraftChange(product.itemId, { ...draft, ...patch });
  }

  async function handleRemove() {
    setRemoving(true);
    try {
      await onRemove(product.itemId);
    } finally {
      setRemoving(false);
    }
  }

  return {
    quota: draft.quota,
    setQuota: (value: string) => setDraft({ quota: value }),
    minOrder: draft.minOrder,
    setMinOrder: (value: string) => setDraft({ minOrder: value }),
    flashPrice: draft.flashPrice,
    setFlashPrice: (value: string) => setDraft({ flashPrice: value }),
    category: draft.category,
    setCategory: (value: string) => setDraft({ category: value }),
    type: draft.type,
    setType: (value: ProductType) => setDraft({ type: value }),
    removing,
    busy,
    canRemove: canEdit && !removing && !busy,
    handleRemove,
  };
}

/** Amber "belum disimpan" marker on a dirty row; red after a failed flush. */
function DirtyChip({ failed }: { failed: boolean }) {
  return (
    <span
      className={cn(
        "rounded-full border px-1.5 py-0.5 text-[10px] font-bold",
        failed
          ? "border-red-200 bg-red-100 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
          : "border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
      )}
    >
      belum disimpan
    </span>
  );
}

/** Marker on a hidden row — the storefront no longer shows it. */
function HiddenChip() {
  return (
    <span className="rounded-full border border-neutral-300 bg-neutral-100 px-1.5 py-0.5 text-[10px] font-bold text-neutral-600 dark:border-border dark:bg-input/40 dark:text-neutral-300">
      Sembunyikan (tidak tampil di toko)
    </span>
  );
}

/**
 * Row background treatment: amber tint while a draft is unsaved, red after a
 * failed flush (the draft is kept), muted while hidden. Hover stays only on
 * clean rows so the flags are never accidentally erased under the cursor.
 */
function rowTintClass(dirty: boolean, failed: boolean, hidden: boolean) {
  return cn(
    "transition",
    !dirty &&
      !failed &&
      "hover:bg-neutral-50/80 dark:hover:bg-input/30",
    dirty && !failed && "bg-amber-500/10",
    failed && "bg-red-500/10",
    hidden && "opacity-60",
  );
}

function CategorySelect({
  row,
  product,
  options,
  fullWidth,
}: {
  row: ReturnType<typeof useRowEdit>;
  product: SessionProduct;
  options: string[];
  fullWidth?: boolean;
}) {
  return (
    <select
      aria-label={`Kategori ${productLabel(product)}`}
      value={row.category}
      onChange={(e) => row.setCategory(e.target.value)}
      disabled={row.busy}
      className={cn(fullWidth && "w-full", cellSelectClass)}
    >
      {/* "" is a deliberate choice — the flush maps it to `category: null`. */}
      <option value="">Umum</option>
      {options.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
  );
}

function TypeSelect({
  row,
  product,
  fullWidth,
}: {
  row: ReturnType<typeof useRowEdit>;
  product: SessionProduct;
  fullWidth?: boolean;
}) {
  return (
    <select
      aria-label={`Tipe ${productLabel(product)}`}
      value={row.type}
      onChange={(e) => row.setType(e.target.value as ProductType)}
      disabled={row.busy}
      className={cn(fullWidth && "w-full", cellSelectClass)}
    >
      {PRODUCT_TYPES.map((t) => (
        <option key={t} value={t}>
          {PRODUCT_TYPE_LABELS[t]}
        </option>
      ))}
    </select>
  );
}

/** Props shared by the desktop row and the mobile card (Task 7 plumbing). */
type RosterRowProps = {
  product: SessionProduct;
  canEdit: boolean;
  options: string[];
  draft: RowDraft;
  onDraftChange: (itemId: number, next: RowDraft) => void;
  onRemove: (itemId: number) => Promise<void>;
  onToggleHidden: (product: SessionProduct) => void;
  /** Another request touches this row (hide in flight / batch saving). */
  busy: boolean;
  /** Any row operation is in flight — blocks this row's instant buttons. */
  anyBusy: boolean;
  /** Row has unsaved edits (amber) or failed the last flush (red). */
  dirty: boolean;
  failed: boolean;
  /** Hide/show only makes sense while the session is live (ACTIVE/PAUSED). */
  showHideToggle: boolean;
  /** Hard-delete (trash) stays SCHEDULED-only — the API 409s after launch. */
  isScheduled: boolean;
};

/** Desktop inline-edit roster row (design.html:284-345). */
function RosterTableRow({
  product,
  canEdit,
  options,
  draft,
  onDraftChange,
  onRemove,
  onToggleHidden,
  busy,
  anyBusy,
  dirty,
  failed,
  showHideToggle,
  isScheduled,
}: RosterRowProps) {
  const row = useRowEdit({
    product,
    canEdit,
    draft,
    onDraftChange,
    onRemove,
    busy,
  });
  const label = productLabel(product);

  return (
    <tr className={rowTintClass(dirty, failed, product.hidden)}>
      <td className="py-3 pl-4 pr-2">
        <RosterThumb product={product} />
      </td>
      <td className="max-w-[240px] py-3 pr-3">
        <div className="line-clamp-1 font-bold text-neutral-950 dark:text-neutral-50">
          {label}
        </div>
        <div className="font-mono text-[10px] text-neutral-400">
          SKU:{" "}
          <span className="font-bold text-neutral-700 dark:text-neutral-300">
            {product.skuCode ?? "—"}
          </span>
        </div>
        {(product.hidden || dirty) && (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {product.hidden && <HiddenChip />}
            {dirty && <DirtyChip failed={failed} />}
          </div>
        )}
      </td>
      <td className="py-3 px-3">
        {canEdit ? (
          <CategorySelect row={row} product={product} options={options} />
        ) : (
          <span className={readOnlyCellClass}>
            {categoryText(product.category)}
          </span>
        )}
      </td>
      <td className="py-3 px-3">
        {canEdit ? (
          <TypeSelect row={row} product={product} />
        ) : (
          <span className={readOnlyCellClass}>
            {PRODUCT_TYPE_LABELS[product.type]}
          </span>
        )}
      </td>
      <td className="py-3 px-3">
        <span className="font-mono text-emerald-600">
          {product.availableStock ?? "—"}
        </span>
      </td>
      <td className="py-3 px-3">
        {canEdit ? (
          <input
            type="number"
            min={1}
            aria-label={`Kuota ${label}`}
            value={row.quota}
            onChange={(e) => row.setQuota(e.target.value)}
            disabled={row.busy}
            className={`w-16 ${cellInputClass}`}
          />
        ) : (
          <span className={readOnlyCellClass}>{product.sessionQuota}</span>
        )}
      </td>
      <td className="py-3 px-3">
        <span className={`${readOnlyCellClass} tabular-nums`}>
          {product.claimed}/{product.sessionQuota}
        </span>
      </td>
      <td className="py-3 px-3">
        {canEdit ? (
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={1}
              aria-label={`Min. Pesanan ${label}`}
              value={row.minOrder}
              onChange={(e) => row.setMinOrder(e.target.value)}
              disabled={row.busy}
              className={`w-14 ${cellInputBrandClass}`}
            />
            <span className="font-mono text-[10px] text-neutral-400">pcs</span>
          </div>
        ) : (
          <span className={readOnlyCellClass}>{product.minOrder}</span>
        )}
      </td>
      <td className="py-3 px-3">
        {canEdit ? (
          <input
            type="number"
            min={0}
            step={10000}
            aria-label={`Harga Flash ${label}`}
            value={row.flashPrice}
            onChange={(e) => row.setFlashPrice(e.target.value)}
            disabled={row.busy}
            className={`w-28 ${cellInputClass}`}
          />
        ) : (
          <span className={`${readOnlyCellClass} tabular-nums`}>
            {product.flashPrice}
          </span>
        )}
      </td>
      <td className="py-3 pl-2 pr-4 text-right">
        {canEdit && (showHideToggle || isScheduled) && (
          <div className="flex items-center justify-end gap-1">
            {showHideToggle && (
              <Button
                variant="ghost"
                size="icon-xs"
                className="text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-input/40"
                isLoading={busy}
                disabled={anyBusy}
                aria-label={product.hidden ? "Tampilkan lagi" : "Sembunyikan"}
                onClick={() => onToggleHidden(product)}
              >
                {product.hidden ? <EyeIcon /> : <EyeSlashIcon />}
              </Button>
            )}
            {isScheduled && (
              <Button
                variant="ghost"
                size="icon-xs"
                className="text-neutral-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                isLoading={row.removing}
                disabled={!row.canRemove}
                aria-label={`Hapus ${label}`}
                onClick={row.handleRemove}
              >
                <TrashIcon />
              </Button>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}

/** Mobile roster card (design.html:351-416). */
function RosterCard({
  product,
  canEdit,
  options,
  draft,
  onDraftChange,
  onRemove,
  onToggleHidden,
  busy,
  anyBusy,
  dirty,
  failed,
  showHideToggle,
  isScheduled,
}: RosterRowProps) {
  const row = useRowEdit({
    product,
    canEdit,
    draft,
    onDraftChange,
    onRemove,
    busy,
  });
  const label = productLabel(product);

  return (
    <div className={cn("space-y-3 p-4", rowTintClass(dirty, failed, product.hidden))}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <RosterThumb product={product} size="card" />
          <div className="min-w-0">
            <h4 className="line-clamp-1 text-xs font-bold text-neutral-950 dark:text-neutral-50">
              {label}
            </h4>
            <div className="mt-0.5 font-mono text-[10px] text-neutral-400">
              SKU:{" "}
              <span className="font-bold text-neutral-800 dark:text-neutral-200">
                {product.skuCode ?? "—"}
              </span>
            </div>
            <div className="font-mono text-[10px] text-emerald-700 dark:text-emerald-500">
              Stok Jubelio:{" "}
              <strong>{product.availableStock ?? "—"} pcs</strong>
            </div>
            {(product.hidden || dirty) && (
              <div className="mt-1 flex flex-wrap items-center gap-1">
                {product.hidden && <HiddenChip />}
                {dirty && <DirtyChip failed={failed} />}
              </div>
            )}
          </div>
        </div>
        {canEdit && (showHideToggle || isScheduled) && (
          <div className="flex shrink-0 items-center gap-1">
            {showHideToggle && (
              <Button
                variant="ghost"
                size="icon-xs"
                className="text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-input/40"
                isLoading={busy}
                disabled={anyBusy}
                aria-label={product.hidden ? "Tampilkan lagi" : "Sembunyikan"}
                onClick={() => onToggleHidden(product)}
              >
                {product.hidden ? <EyeIcon /> : <EyeSlashIcon />}
              </Button>
            )}
            {isScheduled && (
              <Button
                variant="ghost"
                size="icon-xs"
                className="text-neutral-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                isLoading={row.removing}
                disabled={!row.canRemove}
                aria-label={`Hapus ${label}`}
                onClick={row.handleRemove}
              >
                <TrashIcon />
              </Button>
            )}
          </div>
        )}
      </div>

      {canEdit ? (
        <>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="block font-mono text-[9px] uppercase text-neutral-500">
                Kategori
              </span>
              <CategorySelect
                row={row}
                product={product}
                options={options}
                fullWidth
              />
            </div>
            <div>
              <span className="block font-mono text-[9px] uppercase text-neutral-500">
                Tipe
              </span>
              <TypeSelect row={row} product={product} fullWidth />
            </div>
            <div>
              <span className="block font-mono text-[9px] uppercase text-neutral-500">
                Kuota
              </span>
              <input
                type="number"
                min={1}
                value={row.quota}
                onChange={(e) => row.setQuota(e.target.value)}
                disabled={row.busy}
                aria-label={`Kuota ${label}`}
                className={`w-full ${cellInputClass}`}
              />
            </div>
            <div>
              <span className="block font-mono text-[9px] uppercase text-neutral-500">
                Min. Pesanan
              </span>
              <input
                type="number"
                min={1}
                value={row.minOrder}
                onChange={(e) => row.setMinOrder(e.target.value)}
                disabled={row.busy}
                aria-label={`Min. Pesanan ${label}`}
                className={`w-full ${cellInputBrandClass}`}
              />
            </div>
            <div className="col-span-2">
              <span className="block font-mono text-[9px] uppercase text-neutral-500">
                Harga Flash (Rp)
              </span>
              <input
                type="number"
                min={0}
                step={10000}
                value={row.flashPrice}
                onChange={(e) => row.setFlashPrice(e.target.value)}
                disabled={row.busy}
                aria-label={`Harga Flash ${label}`}
                className={`w-full ${cellInputClass}`}
              />
            </div>
          </div>
        </>
      ) : (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
          {(
            [
              ["Kategori", categoryText(product.category)],
              ["Tipe", PRODUCT_TYPE_LABELS[product.type]],
              ["Kuota", String(product.sessionQuota)],
              ["Terklaim", `${product.claimed}/${product.sessionQuota}`],
              ["Min. Pesanan", String(product.minOrder)],
              ["Harga Flash (Rp)", String(product.flashPrice)],
            ] as const
          ).map(([key, value]) => (
            <div key={key}>
              <dt className="font-mono text-[9px] uppercase text-neutral-500">
                {key}
              </dt>
              <dd className={`${readOnlyCellClass} font-bold`}>{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function EmptyRoster({
  canEdit,
  onImport,
}: {
  canEdit: boolean;
  onImport: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
      {/* Brief calls for Phosphor `BoxIcon`; this icon set version has no Box —
          PackageIcon is the closest box glyph. */}
      <PackageIcon className="h-12 w-12 text-neutral-300 dark:text-neutral-600" />
      <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
        Belum ada produk
      </p>
      {canEdit ? (
        <Button variant="ink" onClick={onImport}>
          Pilih Produk Jubelio
        </Button>
      ) : (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Belum ada produk dalam sesi ini.
        </p>
      )}
    </div>
  );
}

/**
 * Product picker for a session (spec §4.3) + the roster panel. Catalog search
 * lives in a Dialog modal (design.html Modal 1) that live-queries
 * `/api/jubelio/products` and toggles rows between `+ Tambah` and
 * `✓ Ditambah`; adds POST to `/api/sessions/[id]/products`, un-adds reuse the
 * roster `DELETE` (SCHEDULED only — after launch a re-add of a hidden row is
 * the server-side UNHIDE, and removal is the `hidden` flag).
 * Editable while `canEditProducts` (SCHEDULED/ACTIVE/PAUSED, spec §5.9
 * relaxed): numeric edits are drafts flushed by the roster's single Save bar
 * (Task 7 — no per-row Simpan), hide/show is instant per row. ENDED renders
 * read-only cells with no controls at all.
 */
function ProductPicker({
  sessionId,
  sessionStatus,
  initialProducts,
}: {
  sessionId: string;
  sessionStatus: string;
  initialProducts: SessionProduct[];
}) {
  // The pure edit window (Task 3): SCHEDULED + live statuses editable, ENDED
  // frozen. Hide/show only makes sense once the sale is live; trash stays
  // SCHEDULED-only (an activated session must never lose a referenced row).
  const canEdit = canEditProducts(sessionStatus);
  const isLive = sessionStatus === "ACTIVE" || sessionStatus === "PAUSED";
  const isScheduled = sessionStatus === "SCHEDULED";

  const [products, setProducts] = useState<SessionProduct[]>(initialProducts);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");
  /** The full catalog loads once per mount — the route serves a 60 s server
   * cache (spec: upstream rejects query params, so search is client-side).
   * `null` = not loaded yet. */
  const [catalog, setCatalog] = useState<SearchResult[] | null>(null);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  /** Catalog load failed (ERP down / non-OK response) — the plate must read
   * as "gagal memuat", not "produk tidak ditemukan" (final review I-4).
   * Cleared by the next successful load. */
  const [loadErrored, setLoadErrored] = useState(false);
  /** Item currently in-flight on an add/remove/hide POST-DELETE-PUT
   * (single-flight). */
  const [busyItem, setBusyItem] = useState<number | null>(null);
  /** Unsaved per-row edits, keyed by itemId — the Save bar's draft model. */
  const [drafts, setDrafts] = useState<Map<number, RowDraft>>(() => new Map());
  /** Rows whose last flush failed: kept dirty with a red tint (spec R5). */
  const [failedItems, setFailedItems] = useState<Set<number>>(() => new Set());
  /** Batch save in flight — disables the Save bar and every row's inputs. */
  const [savingAll, setSavingAll] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const signOutOnExpiry = useSessionExpiry();
  const router = useRouter();

  const categories = categoryOptions(products.map((p) => p.category));
  // Live sessions: a hidden roster row is absent from the storefront, so the
  // modal must NOT mark it `✓ Ditambah` — `+ Tambah` on it means "show again"
  // (the POST's unhide-only path, Task 4). SCHEDULED rows are never hidden.
  const selected = useMemo(
    () =>
      selectedItemIds(isLive ? products.filter((p) => !p.hidden) : products),
    [products, isLive],
  );

  function updateDraft(itemId: number, next: RowDraft) {
    setDrafts((prev) => {
      const copy = new Map(prev);
      copy.set(itemId, next);
      return copy;
    });
  }

  // Drop a draft the server has now confirmed (flush success, POST unhide):
  // once every draft field equals the saved row it carries no pending change.
  function dropRedundantDrafts(confirmed: readonly SessionProduct[]) {
    setDrafts((prev) => {
      if (prev.size === 0) return prev;
      const copy = new Map(prev);
      for (const p of confirmed) {
        const d = copy.get(p.itemId);
        if (
          d?.quota === String(p.sessionQuota) &&
          d?.minOrder === String(p.minOrder) &&
          d?.flashPrice === String(p.flashPrice) &&
          categoryText(d?.category ?? "") === categoryText(p.category) &&
          d?.type === p.type
        ) {
          copy.delete(p.itemId);
        }
      }
      return copy;
    });
  }

  // The dirty set for tint / chip / count: numeric diffs come from the tested
  // `dirtyPatches`; category/type diffs ride the same PUT bodies so a
  // select-only edit is still saved (spec Goal 1 lists them as editable).
  const flushRows = useMemo(() => {
    const rows: Array<{ itemId: number; body: RowPatchBody }> = [];
    if (!canEdit) return rows;
    const byId = new Map<number, RowPatchBody>();
    for (const { itemId, patch } of dirtyPatches(products, drafts)) {
      byId.set(itemId, { ...patch });
    }
    for (const product of products) {
      const draft = drafts.get(product.itemId);
      if (!draft) continue;
      const body: RowPatchBody = byId.get(product.itemId) ?? {};
      // "" is the deliberate "Umum" choice → store null (nullable column,
      // storefront groups null as Umum); comparison goes through categoryText
      // so legacy "" rows and the null draft never look dirty to each other.
      if (categoryText(draft.category) !== categoryText(product.category)) {
        body.category = draft.category.trim() === "" ? null : draft.category;
      }
      if (draft.type !== product.type) body.type = draft.type;
      if (Object.keys(body).length > 0) byId.set(product.itemId, body);
    }
    for (const [itemId, body] of byId) rows.push({ itemId, body });
    return rows;
  }, [canEdit, products, drafts]);

  const dirtyIds = useMemo(
    () => new Set(flushRows.map((r) => r.itemId)),
    [flushRows],
  );

  // "Save stays blocked by rowCanSave": any draft whose three numbers fail the
  // old per-row guard keeps the whole Save disabled until it parses again.
  const hasInvalidDraft = useMemo(() => {
    for (const draft of drafts.values()) {
      if (!canSaveRow(draft)) return true;
    }
    return false;
  }, [drafts]);

  // Focus the search field each time the modal opens (base-ui restores focus
  // to the popup; the catalog is meaningless without a query).
  useEffect(() => {
    if (pickerOpen) searchInputRef.current?.focus({ preventScroll: true });
  }, [pickerOpen]);

  // Load the catalog the first time the dialog opens. A failed load leaves
  // `catalog` null but marks `loadErrored`, which keeps the guard closed —
  // closing and reopening the dialog clears it and retries (C-1: without the
  // errored term the loadingCatalog flip re-ran this effect forever).
  useEffect(() => {
    if (!pickerOpen) {
      setLoadErrored(false);
      return;
    }
    if (
      !shouldLoadCatalog({
        open: pickerOpen,
        loaded: catalog !== null,
        inFlight: loadingCatalog,
        errored: loadErrored,
      })
    ) {
      return;
    }
    setLoadingCatalog(true);
    void (async () => {
      try {
        const res = await fetch("/api/jubelio/products");
        if (res.status === 401) {
          // Count the expired-token path as an errored load too, or the
          // finally-flip below would re-run this effect into a sign-out loop.
          setLoadErrored(true);
          await signOutOnExpiry();
          return;
        }
        // Non-OK is an ERP failure, not an empty catalogue — surface the real
        // upstream message (spec: error honesty) instead of asserting
        // "not found" on silence (final review I-4).
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as
            | { error?: string }
            | null;
          throw new Error(data?.error ?? `HTTP ${res.status}`);
        }
        const data = (await res.json().catch(() => [])) as SearchResult[];
        setCatalog(Array.isArray(data) ? data : []);
        setLoadErrored(false);
      } catch (e) {
        setLoadErrored(true);
        toast.error(
          e instanceof Error && e.message
            ? e.message
            : "Gagal memuat katalog ERP — coba lagi.",
        );
      } finally {
        setLoadingCatalog(false);
      }
    })();
  }, [pickerOpen, catalog, loadingCatalog, loadErrored, signOutOnExpiry]);

  const debouncedSearch = useDebouncedValue(search, 300);
  const results = useMemo(
    () => (catalog ? filterCatalog(catalog, debouncedSearch) : []),
    [catalog, debouncedSearch],
  );

  async function add(product: SearchResult) {
    // While live, a rostered-but-hidden row shows `+ Tambah`; the POST then
    // takes the unhide-only path server-side and the row comes back in
    // `products` — same merge, different toast (nothing was "added").
    const wasRostered = products.some((p) => p.itemId === product.itemId);
    setBusyItem(product.itemId);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/products`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([
          {
            itemId: product.itemId,
            skuCode: product.skuCode,
            itemGroupName: product.itemGroupName,
            originalPrice: product.price,
          },
        ]),
      });
      const data = (await res.json().catch(() => null)) as
        | {
            ok?: boolean;
            products?: SessionProduct[];
            skipped?: { itemId: number; skuCode?: string }[];
            error?: string;
          }
        | null;
      if (res.status === 401) {
        await signOutOnExpiry();
        return;
      }
      if (!res.ok || !data?.ok) {
        toast.error(data?.error ?? "Gagal menambah produk.");
        return;
      }
      // Import guard (Task 5): rows the v2 lookup could not number are
      // skipped server-side and never persisted — name the count, and leave
      // them addable (they stay out of `products`, so the roster and the
      // `✓ Ditambah` toggle don't move for them).
      if (data.skipped?.length) {
        toast.error(
          `${data.skipped.length} produk dilewati — stok belum bisa dicek di ERP, coba lagi.`,
        );
      }
      const added = data.products ?? [];
      if (added.length > 0) {
        // POST answers with raw drizzle rows (no v2 join) — pass the picked
        // catalog row so the merged roster row shows the same thumbnail and
        // stock the admin just saw in the search list, not a letter tile +
        // "—" until the next reload.
        setProducts((prev) => mergeProductsById(prev, added, [product]));
        // An unhide never touches config, so a draft that merely repeats the
        // saved values is no longer a pending change — retire it.
        dropRedundantDrafts(added);
        toast.success(
          wasRostered && isLive ? "Produk ditampilkan." : "Produk ditambahkan.",
        );
      }
    } catch {
      toast.error("Terjadi kesalahan, coba lagi.");
    } finally {
      setBusyItem(null);
    }
  }

  /** The picker's `✓ Ditambah` side of the toggle: reuses the roster DELETE
   * (SCHEDULED only — the DELETE 409s once the session is live). */
  async function unadd(product: SearchResult) {
    setBusyItem(product.itemId);
    try {
      await remove(product.itemId);
    } finally {
      setBusyItem(null);
    }
  }

  /** Live sessions have no un-add: `✓ Ditambah` on a visible roster row
   * hides it (same instant PUT the roster's eye button uses). */
  function hideRostered(row: SearchResult) {
    const product = products.find((p) => p.itemId === row.itemId);
    if (product) void toggleHidden(product);
  }

  /**
   * Instant hide/show PUT (spec Goal 3: per-button loading, no batch).
   * `{hidden}` alone is a valid body; the stock-map/quota path is not touched,
   * but `getSession` auth can still 401 — route it through the expiry hook
   * like every other admin fetch instead of toasting a raw failure.
   */
  async function toggleHidden(product: SessionProduct) {
    if (busyItem !== null || savingAll) return;
    setBusyItem(product.itemId);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/products/${product.itemId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hidden: !product.hidden } satisfies RowPatchBody),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; product?: SessionProduct; error?: string }
        | null;
      if (res.status === 401) {
        await signOutOnExpiry();
        return;
      }
      if (!res.ok || !data?.ok) {
        toast.error(data?.error ?? "Gagal menyimpan produk.");
        return;
      }
      if (data.product) {
        setProducts((prev) => mergeProductsById(prev, [data.product!]));
      }
      toast.success(product.hidden ? "Produk ditampilkan." : "Produk disembunyikan.");
    } catch {
      toast.error("Terjadi kesalahan, coba lagi.");
    } finally {
      setBusyItem(null);
    }
  }

  /**
   * The roster's single Save (spec Goal 3 + R5): concurrent partial PUTs from
   * `dirtyPatches` (plus any category/type diff on the same rows). Failure is
   * per row — a failed row keeps its draft and turns red while the others
   * land; nothing silently reverts. A 401 anywhere is token expiry: sign out
   * through the shared hook, leave the drafts untouched.
   */
  async function flush() {
    // An in-flight row action (hide/show PUT) merges its response after the
    // fact; a concurrent flush on the same row would last-write-win the client
    // state until remount. Wait for the single-flight slot instead (Task 7
    // review).
    if (flushRows.length === 0 || hasInvalidDraft || savingAll || busyItem !== null)
      return;
    setSavingAll(true);
    type FlushResult =
      | { itemId: number; ok: true; product?: SessionProduct; warning?: string }
      | { itemId: number; ok: false; expired?: boolean; error: string };
    const results = await Promise.all(
      flushRows.map(async ({ itemId, body }): Promise<FlushResult> => {
        try {
          const res = await fetch(
            `/api/sessions/${sessionId}/products/${itemId}`,
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            },
          );
          const data = (await res.json().catch(() => null)) as
            | {
                ok?: boolean;
                product?: SessionProduct;
                error?: string;
                warning?: string;
              }
            | null;
          if (res.status === 401) {
            return { itemId, ok: false, expired: true, error: "" };
          }
          if (!res.ok || !data?.ok) {
            return { itemId, ok: false, error: data?.error ?? "" };
          }
          return { itemId, ok: true, product: data.product, warning: data.warning };
        } catch {
          return { itemId, ok: false, error: "" };
        }
      }),
    );
    try {
      if (results.some((r) => !r.ok && r.expired)) {
        await signOutOnExpiry();
        return;
      }
      const ok = results.filter(
        (r): r is Extract<FlushResult, { ok: true }> => r.ok,
      );
      const failed = results.filter(
        (r): r is Extract<FlushResult, { ok: false }> => !r.ok,
      );
      if (ok.length > 0) {
        // PUT answers with raw drizzle rows (no v2 join) — merge keeps each
        // row's live thumbnail/stock (final review I-5).
        setProducts((prev) =>
          mergeProductsById(
            prev,
            ok.filter((r) => r.product).map((r) => r.product!),
          ),
        );
        setDrafts((prev) => {
          const copy = new Map(prev);
          for (const r of ok) copy.delete(r.itemId);
          return copy;
        });
        setFailedItems((prev) => {
          const copy = new Set(prev);
          for (const r of ok) copy.delete(r.itemId);
          return copy;
        });
        for (const r of ok) {
          // Task 4: a live quota write with an unreadable stock number saves
          // anyway and says so — per-response top-level `warning`.
          if (r.warning === "UNKNOWN_STOCK") {
            const row = products.find((p) => p.itemId === r.itemId);
            const sku = row?.skuCode ?? `Item #${r.itemId}`;
            toast.warning(`Stok belum tentu akurat untuk ${sku}.`);
          }
        }
      }
      if (failed.length > 0) {
        setFailedItems((prev) => {
          const copy = new Set(prev);
          for (const r of failed) copy.add(r.itemId);
          return copy;
        });
        const firstMessage =
          failed.map((r) => r.error.trim()).find((m) => m !== "") ??
          "Terjadi kesalahan, coba lagi.";
        toast.error(
          `Gagal menyimpan ${failed.length} produk: ${firstMessage}`,
        );
      } else {
        toast.success("Perubahan produk tersimpan.");
        router.refresh();
      }
    } finally {
      setSavingAll(false);
    }
  }

  async function remove(itemId: number) {
    try {
      const res = await fetch(`/api/sessions/${sessionId}/products/${itemId}`, {
        method: "DELETE",
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;
      if (res.status === 401) {
        // Same routing as every other fetch in this island: a 401 is token
        // expiry, not a failed delete — sign out instead of toasting a raw
        // failure the admin cannot act on.
        await signOutOnExpiry();
        return;
      }
      if (!res.ok || !data?.ok) {
        toast.error(data?.error ?? "Gagal menghapus produk.");
        return;
      }
      setProducts((prev) => prev.filter((p) => p.itemId !== itemId));
      toast.success("Produk dihapus.");
    } catch {
      toast.error("Terjadi kesalahan, coba lagi.");
    }
  }

  function openPicker() {
    setPickerOpen(true);
  }

  return (
    <div className="space-y-6">
      {canEdit && (
        <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
          <DialogTrigger render={<Button variant="ink" />}>
            Pilih Produk Jubelio
          </DialogTrigger>
          <DialogContent className="flex max-h-[85vh] w-full max-w-3xl flex-col gap-0 overflow-hidden rounded-2xl border border-neutral-200 bg-white p-0 dark:border-border dark:bg-card sm:max-w-3xl">
            <DialogHeader className="border-b border-neutral-200 bg-neutral-50 p-4 pr-14 dark:border-border dark:bg-input/30 sm:p-5 sm:pr-14">
              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 shrink-0 rounded-full border border-neutral-950 bg-brand-primary dark:border-neutral-50"
                />
                <DialogTitle className="text-sm font-bold uppercase tracking-wider text-neutral-950 dark:text-neutral-50 sm:text-base">
                  Pilih Produk dari Jubelio ERP
                </DialogTitle>
              </div>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Katalog produk disinkron langsung dari Jubelio ERP.
              </p>
            </DialogHeader>

            <div className="flex items-center gap-3 border-b border-neutral-200 bg-white p-3 dark:border-border dark:bg-card sm:p-4">
              <div className="relative flex-1">
                <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                <Input
                  ref={searchInputRef}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="cari nama / SKU…"
                  aria-label="Cari produk di katalog Jubelio"
                  className="h-9 bg-neutral-50 pl-8 font-mono text-xs dark:bg-input/30"
                />
              </div>
              <span className="shrink-0 whitespace-nowrap font-mono text-xs text-neutral-500 dark:text-neutral-400">
                {loadErrored && catalog === null
                  ? "—"
                  : catalog
                    ? `${results.length}/${catalog.length}`
                    : "…"}{" "}
                SKU
              </span>
            </div>

            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-neutral-50/50 p-3 dark:bg-input/20 sm:p-4">
              {loadingCatalog &&
                [0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-16 rounded-xl" />
                ))}

              {/* Search failure plate (final review I-4) — same shell as the
                  not-found copy, but it says the ERP is unreachable, not
                  that the catalogue has no match. */}
              {!loadingCatalog && loadErrored && catalog === null && (
                  <p className="py-8 text-center text-xs text-neutral-500 dark:text-neutral-400">
                    Gagal memuat katalog — periksa koneksi ERP.
                    <span className="mt-1 block text-neutral-400 dark:text-neutral-500">
                      Tutup lalu buka picker untuk mencoba lagi.
                    </span>
                  </p>
                )}

              {!loadingCatalog &&
                !loadErrored &&
                search.trim() !== "" &&
                results.length === 0 && (
                  <p className="py-8 text-center text-xs text-neutral-500 dark:text-neutral-400">
                    Produk tidak ditemukan. Coba kata kunci lain.
                  </p>
                )}

              {!loadingCatalog &&
                results.map((r) => {
                  const label = r.itemGroupName || r.skuCode;
                  const isAdded = selected.has(r.itemId);
                  // Task 8: the zero-stock guard bites the ADD side only — a
                  // rostered row (✓ Ditambah) must stay hide/remove-able.
                  // In live sessions a hidden roster row shows `+ Tambah`
                  // (re-add = unhide), so it is guarded too: it re-enters
                  // the sale.
                  const stockBlocked =
                    !isAdded && canAddRow(r.stock) === false;
                  return (
                    <div
                      key={r.itemId}
                      className="flex items-center justify-between gap-2 rounded-xl border border-neutral-200 bg-white p-2.5 transition hover:border-neutral-300 dark:border-border dark:bg-card sm:gap-3 sm:p-3"
                    >
                      <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
                        <SearchThumb image={r.image} label={label} />
                        <div className="min-w-0">
                          <div className="truncate text-xs font-bold text-neutral-950 dark:text-neutral-50">
                            {label}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] font-mono text-neutral-500 sm:gap-2">
                            <StatusBadge tone="neutral">
                              {r.skuCode || "—"}
                            </StatusBadge>
                            <span className="text-neutral-400 line-through dark:text-neutral-500">
                              {formatRupiah(r.price)}
                            </span>
                            {/* Zero stock turns the cell red so the
                                disabled `+ Tambah` reads as caused (Task 8). */}
                            <span
                              className={cn(
                                "font-mono tabular-nums",
                                r.stock === 0 &&
                                  "font-bold text-red-600 dark:text-red-400",
                              )}
                            >
                              Stok {r.stock ?? "—"}
                            </span>
                          </div>
                        </div>
                      </div>
                      <Button
                        size="xs"
                        variant="ghost"
                        aria-pressed={isAdded}
                        aria-label={
                          isAdded
                            ? isLive
                              ? `Sembunyikan ${label} dari toko`
                              : `Hapus ${label} dari roster`
                            : `Tambah ${label} ke roster`
                        }
                        isLoading={busyItem === r.itemId}
                        disabled={stockBlocked || busyItem !== null}
                        title={stockBlocked ? "Stok 0" : undefined}
                        onClick={() =>
                          isAdded
                            ? isLive
                              ? hideRostered(r)
                              : unadd(r)
                            : add(r)
                        }
                        className={cn(
                          "shrink-0 rounded-lg font-bold",
                          isAdded
                            ? "border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-950/60"
                            : "border border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:bg-amber-950/60",
                        )}
                      >
                        {isAdded ? "✓ Ditambah" : "+ Tambah"}
                      </Button>
                    </div>
                  );
                })}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-neutral-200 bg-neutral-50 p-3 dark:border-border dark:bg-input/30 sm:p-4">
              <span className="font-mono text-xs text-neutral-500 dark:text-neutral-400">
                <b className="text-neutral-950 dark:text-neutral-50">
                  {selected.size} dipilih
                </b>
              </span>
              <DialogClose render={<Button variant="ink" />}>
                Selesai Konfigurasi
              </DialogClose>
            </div>
          </DialogContent>
        </Dialog>
      )}

      <Panel title="Roster Produk" count={`${products.length} produk siap`}>
        {canEdit && products.length > 0 && (
          <p className="border-b border-neutral-100 bg-neutral-50/70 px-4 py-2 text-xs text-neutral-500 dark:border-border dark:bg-input/30 dark:text-neutral-400">
            Atur Kategori, Tipe, Kuota, dan Min. Pesanan per produk.
          </p>
        )}

        {products.length === 0 ? (
          <EmptyRoster canEdit={canEdit} onImport={openPicker} />
        ) : (
          <>
            {/* Desktop inline-edit table (design.html:268-348) */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-neutral-200 bg-neutral-100/70 font-mono text-[10px] uppercase text-neutral-600 dark:border-border dark:bg-input/30 dark:text-neutral-400">
                  <tr>
                    <th scope="col" className="py-3 pl-4 pr-2">
                      <span className="sr-only">Gambar</span>
                    </th>
                    <th scope="col" className="py-3 pr-3">
                      Produk &amp; SKU
                    </th>
                    <th scope="col" className="py-3 px-3">
                      Kategori
                    </th>
                    <th scope="col" className="py-3 px-3">
                      Tipe
                    </th>
                    <th scope="col" className="py-3 px-3">
                      Stok Jubelio
                    </th>
                    <th scope="col" className="py-3 px-3">
                      Kuota
                    </th>
                    <th scope="col" className="py-3 px-3">
                      Terklaim
                    </th>
                    <th scope="col" className="py-3 px-3">
                      Min. Pesanan
                    </th>
                    <th scope="col" className="py-3 px-3">
                      Harga Flash (Rp)
                    </th>
                    <th scope="col" className="py-3 pl-2 pr-4 text-right">
                      Aksi
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100 font-medium dark:divide-border">
                  {products.map((p) => (
                    <RosterTableRow
                      key={p.itemId}
                      product={p}
                      canEdit={canEdit}
                      options={categories}
                      draft={drafts.get(p.itemId) ?? defaultDraft(p)}
                      onDraftChange={updateDraft}
                      onRemove={remove}
                      onToggleHidden={toggleHidden}
                      busy={busyItem === p.itemId || savingAll}
                      anyBusy={busyItem !== null || savingAll}
                      dirty={dirtyIds.has(p.itemId)}
                      failed={failedItems.has(p.itemId)}
                      showHideToggle={canEdit && isLive}
                      isScheduled={isScheduled}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile card roster (design.html:351-416) */}
            <div className="md:hidden divide-y divide-neutral-100 dark:divide-border">
              {products.map((p) => (
                <RosterCard
                  key={p.itemId}
                  product={p}
                  canEdit={canEdit}
                  options={categories}
                  draft={drafts.get(p.itemId) ?? defaultDraft(p)}
                  onDraftChange={updateDraft}
                  onRemove={remove}
                  onToggleHidden={toggleHidden}
                  busy={busyItem === p.itemId || savingAll}
                  anyBusy={busyItem !== null || savingAll}
                  dirty={dirtyIds.has(p.itemId)}
                  failed={failedItems.has(p.itemId)}
                  showHideToggle={canEdit && isLive}
                  isScheduled={isScheduled}
                />
              ))}
            </div>

            {/* Roster's single Save bar (spec Goal 3): replaces every per-row
                Simpan. Dirty rows flush as concurrent partial PUTs. */}
            {canEdit && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-200 bg-neutral-50 px-4 py-3 dark:border-border dark:bg-input/30">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.5 font-mono text-[10px] font-bold",
                      dirtyIds.size > 0
                        ? "border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
                        : "border-neutral-200 bg-neutral-100 text-neutral-500 dark:border-border dark:bg-input/40 dark:text-neutral-400",
                    )}
                  >
                    {dirtyIds.size} belum disimpan
                  </span>
                  {hasInvalidDraft && (
                    <span className="text-[10px] font-medium text-red-600 dark:text-red-400">
                      Ada nilai yang belum valid — perbaiki dulu sebelum
                      menyimpan.
                    </span>
                  )}
                </div>
                <Button
                  variant="ink"
                  isLoading={savingAll}
                  disabled={
                    dirtyIds.size === 0 || hasInvalidDraft || busyItem !== null
                  }
                  onClick={flush}
                >
                  <FloppyDiskIcon
                    weight="regular"
                    className="size-4 shrink-0"
                    aria-hidden="true"
                  />
                  Simpan semua perubahan
                </Button>
              </div>
            )}
          </>
        )}
      </Panel>
    </div>
  );
}

// Exported for unit tests — the roster's save guard + dirty-draft → PUT-body
// derivation + read-only category display rule + the picker modal's
// itemId-keyed selection/merge helpers (pure, no React).
export {
  ProductPicker,
  canAddRow,
  canSaveRow,
  categoryText,
  selectedItemIds,
  mergeProductsById,
};
