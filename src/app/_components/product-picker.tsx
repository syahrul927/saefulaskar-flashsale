"use client";

import { useEffect, useRef, useState } from "react";
import { PackageIcon, TrashIcon } from "@phosphor-icons/react";
import { cn } from "cn";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Panel } from "@/app/_components/panel";
import { categoryOptions } from "@/app/_components/category-options";
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

type SearchResult = {
  itemId: number;
  skuCode: string;
  itemGroupName: string;
  price: number;
  minOrder: number;
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
 * Product picker for a session (spec §4.3) + the roster panel. Live-searches
 * the Jubelio catalog, upserts picks via `POST /api/sessions/[id]/products`,
 * and edits/removes rows via `PUT`/`DELETE` on `[id]/products/[itemId]`.
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
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState<number | null>(null);
  const searchSectionRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const signOutOnExpiry = useSessionExpiry();

  const categories = categoryOptions(products.map((p) => p.category));

  useEffect(() => {
    const query = search.trim();
    if (query === "") {
      setResults([]);
      return;
    }
    setSearching(true);
    const handle = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(
            `/api/jubelio/products?search=${encodeURIComponent(query)}`,
          );
          if (res.status === 401) {
            await signOutOnExpiry();
            return;
          }
          const data = (await res.json().catch(() => [])) as SearchResult[];
          setResults(Array.isArray(data) ? data : []);
        } catch {
          setResults([]);
        } finally {
          setSearching(false);
        }
      })();
    }, 300);
    return () => clearTimeout(handle);
  }, [search, signOutOnExpiry]);

  async function add(product: SearchResult) {
    setAdding(product.itemId);
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
      setProducts((prev) => {
        const next = [...prev];
        for (const p of added) {
          const idx = next.findIndex((x) => x.itemId === p.itemId);
          if (idx === -1) next.push(p);
          else next[idx] = p;
        }
        return next;
      });
      toast.success("Produk ditambahkan.");
    } catch {
      toast.error("Terjadi kesalahan, coba lagi.");
    } finally {
      setAdding(null);
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

  function scrollToPicker() {
    searchSectionRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
    searchInputRef.current?.focus({ preventScroll: true });
  }

  return (
    <div className="space-y-6">
      {canEdit && (
        <div ref={searchSectionRef}>
          <FieldLabel htmlFor="product-search">Tambah produk (cari Jubelio)</FieldLabel>
          <div className="relative mt-1.5">
            <Input
              id="product-search"
              ref={searchInputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari nama produk atau SKU..."
              className="h-11 pr-10"
            />
            {searching && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2">
                <Spinner />
              </span>
            )}
          </div>

          {results.length > 0 && (
            <ul className="mt-2 divide-y divide-border rounded-2xl border border-border">
              {results.map((r) => (
                <li
                  key={r.itemId}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <p className="truncate text-foreground">
                      {r.itemGroupName || r.skuCode}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      SKU {r.skuCode} · {formatRupiah(r.price)}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    disabled={adding !== null}
                    onClick={() => add(r)}
                  >
                    {adding === r.itemId ? <Spinner /> : "Tambah"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Panel title="Roster Produk" count={`${products.length} item siap`}>
        {canEdit && products.length > 0 && (
          <p className="border-b border-neutral-100 bg-neutral-50/70 px-4 py-2 text-xs text-neutral-500 dark:border-border dark:bg-input/30 dark:text-neutral-400">
            Atur Kategori, Tipe, Kuota Sale, dan Min. Order per produk.
          </p>
        )}

        {products.length === 0 ? (
          <EmptyRoster canEdit={canEdit} onImport={scrollToPicker} />
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
// display rule (pure, no React).
export { ProductPicker, canSaveRow, categoryText };
