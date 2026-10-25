"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useSessionExpiry } from "@/app/_components/use-session-expiry";

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
  availableStock: number | null;
};

type SearchResult = {
  itemId: number;
  skuCode: string;
  itemGroupName: string;
  price: number;
  minOrder: number;
};

function formatRupiah(value: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
}

function EditableProductRow({
  product,
  canEdit,
  onSave,
  onRemove,
}: {
  product: SessionProduct;
  canEdit: boolean;
  onSave: (itemId: number, patch: {
    sessionQuota: number;
    minOrder: number;
    flashPrice: number;
    category: string;
  }) => Promise<void>;
  onRemove: (itemId: number) => Promise<void>;
}) {
  const [quota, setQuota] = useState(String(product.sessionQuota));
  const [minOrder, setMinOrder] = useState(String(product.minOrder));
  const [flashPrice, setFlashPrice] = useState(String(product.flashPrice));
  const [category, setCategory] = useState(product.category ?? "");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);

  const label = product.itemGroupName ?? product.skuCode ?? `Item #${product.itemId}`;

  return (
    <li className="rounded-2xl border border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{label}</p>
          <p className="text-xs text-muted-foreground">
            SKU {product.skuCode ?? "—"} · Harga asli{" "}
            {formatRupiah(product.originalPrice)} · Tersedia{" "}
            {product.availableStock ?? "—"} · Terklaim {product.claimed}/
            {product.sessionQuota}
          </p>
        </div>
        {canEdit && (
          <Button
            size="sm"
            variant="ghost"
            disabled={removing || saving}
            onClick={async () => {
              setRemoving(true);
              try {
                await onRemove(product.itemId);
              } finally {
                setRemoving(false);
              }
            }}
          >
            {removing ? <Spinner /> : "Hapus"}
          </Button>
        )}
      </div>

      {canEdit && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field>
            <FieldLabel htmlFor={`quota-${product.itemId}`}>Kuota sesi</FieldLabel>
            <Input
              id={`quota-${product.itemId}`}
              type="number"
              min={1}
              value={quota}
              onChange={(e) => setQuota(e.target.value)}
              disabled={saving}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`min-${product.itemId}`}>Min. order</FieldLabel>
            <Input
              id={`min-${product.itemId}`}
              type="number"
              min={1}
              value={minOrder}
              onChange={(e) => setMinOrder(e.target.value)}
              disabled={saving}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`price-${product.itemId}`}>Harga flash</FieldLabel>
            <Input
              id={`price-${product.itemId}`}
              type="number"
              min={0}
              value={flashPrice}
              onChange={(e) => setFlashPrice(e.target.value)}
              disabled={saving}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`cat-${product.itemId}`}>Kategori</FieldLabel>
            <Input
              id={`cat-${product.itemId}`}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              disabled={saving}
              placeholder="mis. Elektronik"
            />
          </Field>
        </div>
      )}

      {canEdit && (
        <div className="mt-3">
          <Button
            size="sm"
            variant="secondary"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await onSave(product.itemId, {
                  sessionQuota: Number(quota),
                  minOrder: Number(minOrder),
                  flashPrice: Number(flashPrice),
                  category,
                });
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? <Spinner /> : null}
            {saving ? "Menyimpan..." : "Simpan"}
          </Button>
        </div>
      )}
    </li>
  );
}

/**
 * Product picker for a session (spec §4.3). Live-searches the Jubelio catalog,
 * upserts picks via `POST /api/sessions/[id]/products`, and edits/removes rows
 * via `PUT`/`DELETE` on `[id]/products/[itemId]`. Read-only when the session
 * has left SCHEDULED (config frozen, spec §5.9).
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
  const signOutOnExpiry = useSessionExpiry();

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

  async function save(itemId: number, patch: {
    sessionQuota: number;
    minOrder: number;
    flashPrice: number;
    category: string;
  }) {
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

  return (
    <div className="space-y-6">
      {canEdit && (
        <div>
          <FieldLabel htmlFor="product-search">Tambah produk (cari Jubelio)</FieldLabel>
          <div className="relative mt-1.5">
            <Input
              id="product-search"
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

      <div>
        <h2 className="text-sm font-medium text-foreground">
          Produk dalam sesi ({products.length})
        </h2>
        {products.length === 0 ? (
          <p className="mt-2 rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {canEdit
              ? "Belum ada produk. Cari produk di atas untuk menambahkan."
              : "Belum ada produk dalam sesi ini."}
          </p>
        ) : (
          <ul className="mt-2 space-y-3">
            {products.map((p) => (
              <EditableProductRow
                key={p.itemId}
                product={p}
                canEdit={canEdit}
                onSave={save}
                onRemove={remove}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export { ProductPicker };