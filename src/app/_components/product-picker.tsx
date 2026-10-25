"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MagnifyingGlassIcon, PackageIcon, TrashIcon } from "@phosphor-icons/react";
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
import { useSessionExpiry } from "@/app/_components/use-session-expiry";
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
  /** Catalog image URL — never populated yet (mockup D6: letter tiles). */
  image?: string | null;
  availableStock: number | null;
};

/** Mirrors `PickerRow` from `/api/jubelio/products` (route `toPickerRows`). */
type SearchResult = {
  itemId: number;
  skuCode: string;
  itemGroupName: string;
  /** Normal (catalog) price — rendered struck in the picker rows. */
  price: number;
  minOrder: number;
  /** Real-time stock; `null` when the master API omits it. */
  stock: number | null;
};

type RowPatch = {
  sessionQuota: number;
  minOrder: number;
  flashPrice: number;
  /** `null` = "Umum" (uncategorised); mirrors the nullable DB column. */
  category: string | null;
  type: ProductType;
};

function formatRupiah(value: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
}

/** Shared class strings for the inline-edit cells (design.html:297-335). */
const cellSelectClass =
  "rounded-lg border border-neutral-200 bg-neutral-50 px-2 py-1 text-xs text-neutral-800 focus:border-brand-primary focus:outline-none dark:border-border dark:bg-input/30 dark:text-neutral-200";
const cellInputClass =
  "rounded-lg border border-neutral-200 bg-neutral-50 px-2 py-1 font-mono text-xs font-bold text-neutral-950 focus:border-brand-primary focus:outline-none dark:border-border dark:bg-input/30 dark:text-neutral-50";
const cellInputAmberClass =
  "rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 font-mono text-xs font-black text-amber-950 focus:border-brand-primary focus:outline-none dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100";
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

/** Letter-tile thumb frame — mockup D6 (real images excluded). */
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
      // Brief pins plain <img class="object-cover">; no next/image config for
      // external Jubelio CDNs yet (images are excluded per mockup D6 anyway).
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
      className={`flex shrink-0 items-center justify-center ${frame} bg-gradient-to-br from-amber-50 to-amber-200`}
    >
      <span className={`${letter} font-black text-amber-700`}>
        {productLabel(product).charAt(0).toUpperCase()}
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
 */
function mergeProductsById(
  prev: readonly SessionProduct[],
  incoming: readonly SessionProduct[],
): SessionProduct[] {
  const next = [...prev];
  for (const p of incoming) {
    const idx = next.findIndex((x) => x.itemId === p.itemId);
    if (idx === -1) next.push(p);
    else next[idx] = p;
  }
  return next;
}

/**
 * Per-row edit state + save/remove handlers, shared by the desktop table row
 * and the mobile card (Review Focus 4: `canEdit === false` renders no
 * controls at all). Preserves the original per-row Simpan guard flow.
 */
function useRowEdit({
  product,
  canEdit,
  onSave,
  onRemove,
}: {
  product: SessionProduct;
  canEdit: boolean;
  onSave: (itemId: number, patch: RowPatch) => Promise<void>;
  onRemove: (itemId: number) => Promise<void>;
}) {
  const [quota, setQuota] = useState(String(product.sessionQuota));
  const [minOrder, setMinOrder] = useState(String(product.minOrder));
  const [flashPrice, setFlashPrice] = useState(String(product.flashPrice));
  const [category, setCategory] = useState(product.category ?? "");
  const [type, setType] = useState<ProductType>(product.type);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(product.itemId, {
        sessionQuota: Number(quota),
        minOrder: Number(minOrder),
        flashPrice: Number(flashPrice),
        // "" is the deliberate "Umum" choice → store null (nullable column,
        // storefront groups null as Umum). Freshly imported rows carry "" in
        // the DB; normalising here keeps them saveable without touching POST.
        category: category.trim() === "" ? null : category,
        type,
      });
    } finally {
      setSaving(false);
    }
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
    quota,
    setQuota,
    minOrder,
    setMinOrder,
    flashPrice,
    setFlashPrice,
    category,
    setCategory,
    type,
    setType,
    saving,
    removing,
    canSave:
      canEdit && !removing && canSaveRow({ quota, minOrder, flashPrice }),
    canRemove: canEdit && !removing && !saving,
    handleSave,
    handleRemove,
  };
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
      disabled={row.saving}
      className={cn(fullWidth && "w-full", cellSelectClass)}
    >
      {/* "" is a deliberate choice — handleSave maps it to `category: null`. */}
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
      disabled={row.saving}
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

/** Desktop inline-edit roster row (design.html:284-345). */
function RosterTableRow({
  product,
  canEdit,
  options,
  onSave,
  onRemove,
}: {
  product: SessionProduct;
  canEdit: boolean;
  options: string[];
  onSave: (itemId: number, patch: RowPatch) => Promise<void>;
  onRemove: (itemId: number) => Promise<void>;
}) {
  const row = useRowEdit({ product, canEdit, onSave, onRemove });
  const label = productLabel(product);

  return (
    <tr className="transition hover:bg-neutral-50/80 dark:hover:bg-input/30">
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
            aria-label={`Kuota Sale ${label}`}
            value={row.quota}
            onChange={(e) => row.setQuota(e.target.value)}
            disabled={row.saving}
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
              aria-label={`Min. Order ${label}`}
              value={row.minOrder}
              onChange={(e) => row.setMinOrder(e.target.value)}
              disabled={row.saving}
              className={`w-14 ${cellInputAmberClass}`}
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
            disabled={row.saving}
            className={`w-28 ${cellInputClass}`}
          />
        ) : (
          <span className={`${readOnlyCellClass} tabular-nums`}>
            {product.flashPrice}
          </span>
        )}
      </td>
      <td className="py-3 pl-2 pr-4 text-right">
        {canEdit && (
          <div className="flex items-center justify-end gap-1">
            <Button
              variant="ink"
              size="xs"
              isLoading={row.saving}
              disabled={row.saving || !row.canSave}
              onClick={row.handleSave}
            >
              Simpan
            </Button>
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
  onSave,
  onRemove,
}: {
  product: SessionProduct;
  canEdit: boolean;
  options: string[];
  onSave: (itemId: number, patch: RowPatch) => Promise<void>;
  onRemove: (itemId: number) => Promise<void>;
}) {
  const row = useRowEdit({ product, canEdit, onSave, onRemove });
  const label = productLabel(product);

  return (
    <div className="space-y-3 p-4">
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
          </div>
        </div>
        {canEdit && (
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
                Kuota Sale
              </span>
              <input
                type="number"
                min={1}
                value={row.quota}
                onChange={(e) => row.setQuota(e.target.value)}
                disabled={row.saving}
                aria-label={`Kuota Sale ${label}`}
                className={`w-full ${cellInputClass}`}
              />
            </div>
            <div>
              <span className="block font-mono text-[9px] uppercase text-neutral-500">
                Min. Order
              </span>
              <input
                type="number"
                min={1}
                value={row.minOrder}
                onChange={(e) => row.setMinOrder(e.target.value)}
                disabled={row.saving}
                aria-label={`Min. Order ${label}`}
                className={`w-full ${cellInputAmberClass}`}
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
                disabled={row.saving}
                aria-label={`Harga Flash ${label}`}
                className={`w-full ${cellInputClass}`}
              />
            </div>
          </div>
          <div className="pt-1">
            <Button
              variant="ink"
              size="xs"
              isLoading={row.saving}
              disabled={row.saving || !row.canSave}
              onClick={row.handleSave}
            >
              Simpan
            </Button>
          </div>
        </>
      ) : (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
          {(
            [
              ["Kategori", categoryText(product.category)],
              ["Tipe", PRODUCT_TYPE_LABELS[product.type]],
              ["Kuota Sale", String(product.sessionQuota)],
              ["Terklaim", `${product.claimed}/${product.sessionQuota}`],
              ["Min. Order", String(product.minOrder)],
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
        <Button variant="brand" onClick={onImport}>
          Import dari Jubelio
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
 * roster `DELETE`. Rows edit via `PUT` on `[id]/products/[itemId]`.
 * Read-only when the session has left SCHEDULED (config frozen, spec §5.9) —
 * roster cells then render as plain mono text with no controls at all.
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
  const canEdit = sessionStatus === "SCHEDULED";

  const [products, setProducts] = useState<SessionProduct[]>(initialProducts);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  /** Item currently in-flight on an add/remove POST-DELETE (single-flight). */
  const [busyItem, setBusyItem] = useState<number | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const signOutOnExpiry = useSessionExpiry();

  const categories = categoryOptions(products.map((p) => p.category));
  const selected = useMemo(() => selectedItemIds(products), [products]);

  // Focus the search field each time the modal opens (base-ui restores focus
  // to the popup; the catalog is meaningless without a query).
  useEffect(() => {
    if (pickerOpen) searchInputRef.current?.focus({ preventScroll: true });
  }, [pickerOpen]);

  useEffect(() => {
    if (!pickerOpen) return;
    const query = search.trim();
    if (query === "") {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    let cancelled = false;
    const handle = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(
            `/api/jubelio/products?search=${encodeURIComponent(query)}`,
          );
          if (cancelled) return;
          if (res.status === 401) {
            await signOutOnExpiry();
            return;
          }
          const data = (await res.json().catch(() => [])) as SearchResult[];
          setResults(Array.isArray(data) ? data : []);
        } catch {
          if (!cancelled) setResults([]);
        } finally {
          if (!cancelled) setSearching(false);
        }
      })();
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [search, signOutOnExpiry, pickerOpen]);

  async function add(product: SearchResult) {
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
        | { ok?: boolean; products?: SessionProduct[]; error?: string }
        | null;
      if (res.status === 401) {
        await signOutOnExpiry();
        return;
      }
      if (!res.ok || !data?.ok) {
        toast.error(data?.error ?? "Gagal menambah produk.");
        return;
      }
      const added = data.products ?? [];
      setProducts((prev) => mergeProductsById(prev, added));
      toast.success("Produk ditambahkan.");
    } catch {
      toast.error("Terjadi kesalahan, coba lagi.");
    } finally {
      setBusyItem(null);
    }
  }

  /** The picker's `✓ Ditambah` side of the toggle: reuses the roster DELETE. */
  async function unadd(product: SearchResult) {
    setBusyItem(product.itemId);
    try {
      await remove(product.itemId);
    } finally {
      setBusyItem(null);
    }
  }

  async function save(itemId: number, patch: RowPatch) {
    try {
      const res = await fetch(`/api/sessions/${sessionId}/products/${itemId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; product?: SessionProduct; error?: string }
        | null;
      if (!res.ok || !data?.ok) {
        toast.error(data?.error ?? "Gagal menyimpan produk.");
        return;
      }
      if (data.product) {
        setProducts((prev) =>
          prev.map((p) => (p.itemId === itemId ? data.product! : p)),
        );
      }
      toast.success("Produk disimpan.");
    } catch {
      toast.error("Terjadi kesalahan, coba lagi.");
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
            + Pilih Produk Jubelio
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
                Cek stok real-time dari seluruh gudang yang terhubung.
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
                {results.length} SKU
              </span>
            </div>

            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-neutral-50/50 p-3 dark:bg-input/20 sm:p-4">
              {searching &&
                [0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-16 rounded-xl" />
                ))}

              {!searching && search.trim() === "" && (
                <p className="py-8 text-center text-xs text-neutral-500 dark:text-neutral-400">
                  Ketik untuk mencari katalog Jubelio.
                </p>
              )}

              {!searching && search.trim() !== "" && results.length === 0 && (
                <p className="py-8 text-center text-xs text-neutral-500 dark:text-neutral-400">
                  Produk tidak ditemukan. Coba kata kunci lain.
                </p>
              )}

              {!searching &&
                results.map((r) => {
                  const label = r.itemGroupName || r.skuCode;
                  const isAdded = selected.has(r.itemId);
                  return (
                    <div
                      key={r.itemId}
                      className="flex items-center justify-between gap-2 rounded-xl border border-neutral-200 bg-white p-2.5 transition hover:border-neutral-300 dark:border-border dark:bg-card sm:gap-3 sm:p-3"
                    >
                      <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
                        <span
                          aria-hidden="true"
                          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-amber-50 to-amber-200 dark:from-amber-950/40 dark:to-amber-900/30"
                        >
                          <span className="text-base font-black text-amber-700 dark:text-amber-400">
                            {label.charAt(0).toUpperCase()}
                          </span>
                        </span>
                        <div className="min-w-0">
                          <div className="truncate text-xs font-bold text-neutral-950 dark:text-neutral-50">
                            {label}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] font-mono text-neutral-500 sm:gap-2">
                            <StatusBadge tone="neutral">
                              {r.skuCode || "—"}
                            </StatusBadge>
                            <span>
                              stok{" "}
                              <b className="font-mono font-bold text-emerald-600 dark:text-emerald-500">
                                {r.stock ?? "—"}
                              </b>
                            </span>
                            <span className="text-neutral-400 line-through dark:text-neutral-500">
                              {formatRupiah(r.price)}
                            </span>
                          </div>
                        </div>
                      </div>
                      <Button
                        size="xs"
                        variant="ghost"
                        aria-pressed={isAdded}
                        aria-label={`${isAdded ? "Hapus " : "Tambah "}${label} ${isAdded ? "dari" : "ke"} roster`}
                        isLoading={busyItem === r.itemId}
                        disabled={busyItem !== null}
                        onClick={() => (isAdded ? unadd(r) : add(r))}
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

      <Panel title="Roster Produk" count={`${products.length} item siap`}>
        {canEdit && products.length > 0 && (
          <p className="border-b border-neutral-100 bg-neutral-50/70 px-4 py-2 text-xs text-neutral-500 dark:border-border dark:bg-input/30 dark:text-neutral-400">
            Atur Kategori, Tipe, Kuota Sale, dan Min. Order per produk.
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
                      Kuota Sale
                    </th>
                    <th scope="col" className="py-3 px-3">
                      Terklaim
                    </th>
                    <th scope="col" className="py-3 px-3">
                      Min. Order
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
                      onSave={save}
                      onRemove={remove}
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
                  onSave={save}
                  onRemove={remove}
                />
              ))}
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}

// Exported for unit tests — the roster's save guard + read-only category
// display rule + the picker modal's itemId-keyed selection/merge helpers
// (pure, no React).
export {
  ProductPicker,
  canSaveRow,
  categoryText,
  selectedItemIds,
  mergeProductsById,
};
