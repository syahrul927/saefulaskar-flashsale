"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import {
  nextQtyAfterAdd,
  nextQtyAfterIncrement,
} from "./cart-rules";

const STORAGE_KEY = "fs-cart";

export type CartItem = {
  sessionProductId: string;
  itemId: number;
  name: string;
  sku: string;
  price: number;
  /** Flash-time original price — powers the drawer "Hemat Rp…" savings line.
   * Optional so carts saved before Task 12 still load (they show no savings). */
  originalPrice?: number;
  minOrder: number;
  /** v2 thumbnail URL at add-time — optional so carts saved before the
   * photo feature still load (those rows show the letter tile). */
  image?: string | null;
  /** Cart ceiling at add-time (`capForProduct`): quota remaining AND ERP
   * stock from the page snapshot. Optional — carts saved before the cap
   * feature (or products without stock info) simply skip the client clamp;
   * the server checkout guard stays the authority. */
  maxQty?: number;
  qty: number;
};

type CartItemInput = Omit<CartItem, "qty">;

type CartContextValue = {
  items: CartItem[];
  add: (item: CartItemInput, qty: number) => void;
  increment: (sessionProductId: string) => void;
  decrement: (sessionProductId: string) => void;
  remove: (sessionProductId: string) => void;
  clear: () => void;
  subtotal: number;
  count: number;
  /** Cart drawer visibility — owned here so the header, mobile bar and any
   * future trigger can open the one drawer mounted in the storefront layout. */
  drawerOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);

const EMPTY: CartItem[] = [];

function loadCart(): CartItem[] {
  if (typeof window === "undefined") return EMPTY;
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) ?? "[]",
    );
    if (!Array.isArray(parsed)) return EMPTY;
    return parsed.filter(
      (row): row is CartItem =>
        !!row &&
        typeof row === "object" &&
        typeof (row as Record<string, unknown>).sessionProductId ===
          "string" &&
        typeof (row as Record<string, unknown>).itemId === "number" &&
        typeof (row as Record<string, unknown>).name === "string" &&
        typeof (row as Record<string, unknown>).sku === "string" &&
        typeof (row as Record<string, unknown>).price === "number" &&
        ((row as Record<string, unknown>).originalPrice === undefined ||
          typeof (row as Record<string, unknown>).originalPrice ===
            "number") &&
        typeof (row as Record<string, unknown>).minOrder === "number" &&
        typeof (row as Record<string, unknown>).qty === "number",
    );
  } catch {
    return EMPTY;
  }
}

function saveCart(items: CartItem[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Private-mode / quota exceeded — keep in memory, drop persistence.
  }
}

function CartProvider({ children }: { children: ReactNode }) {
  // Both server AND the client's first render must see an empty cart —
  // reading localStorage in `useState(loadCart)` made the header badge /
  // aria-label differ between the SSR HTML and hydration ("Hydration
  // failed … CartButton"). The cart is picked up in the mount effect below;
  // `loaded` keeps that effect from letting the save effect wipe a stored
  // cart with the initial empty state first.
  const [items, setItems] = useState<CartItem[]>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    setItems(loadCart());
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) saveCart(items);
  }, [items, loaded]);

  const add = useCallback(
    (item: CartItemInput, qty: number) => {
      const normalizedQty = Math.max(item.minOrder, Math.floor(qty));
      const existing = items.find(
        (row) => row.sessionProductId === item.sessionProductId,
      );
      const decision = nextQtyAfterAdd({
        currentQty: existing?.qty ?? 0,
        addQty: normalizedQty,
        minOrder: item.minOrder,
        // No cap info (legacy cart row / unknown stock) → no client clamp;
        // the server guard still decides at checkout.
        cap: item.maxQty ?? Infinity,
      });
      if (decision.kind === "unbuyable") {
        toast.error(
          `Sisa stok tidak cukup untuk minimum order ${item.minOrder}.`,
        );
        return;
      }
      if (decision.kind === "at-max") {
        toast.info(`Sisa tinggal ${item.maxQty}.`);
        return;
      }
      setItems((prev) => {
        const row = prev.find(
          (r) => r.sessionProductId === item.sessionProductId,
        );
        if (!row) return [...prev, { ...item, qty: decision.qty }];
        return prev.map((r) =>
          r.sessionProductId === item.sessionProductId
            ? { ...r, ...item, qty: decision.qty }
            : r,
        );
      });
      toast.success(
        `${decision.qty} x ${item.name} ditambahkan ke keranjang`,
      );
      if (decision.clamped) {
        toast.info(`Dibatasi sisa stok — tinggal ${item.maxQty}.`);
      }
    },
    [items],
  );

  const increment = useCallback(
    (sessionProductId: string) => {
      const row = items.find((r) => r.sessionProductId === sessionProductId);
      if (!row) return;
      if (row.maxQty === undefined) {
        setItems((prev) =>
          prev.map((r) =>
            r.sessionProductId === sessionProductId ? { ...r, qty: r.qty + 1 } : r,
          ),
        );
        return;
      }
      const decision = nextQtyAfterIncrement({
        currentQty: row.qty,
        cap: row.maxQty,
      });
      if (decision.kind === "at-max") {
        toast.info(`Sisa tinggal ${row.maxQty}.`);
        return;
      }
      setItems((prev) =>
        prev.map((r) =>
          r.sessionProductId === sessionProductId
            ? { ...r, qty: decision.qty }
            : r,
        ),
      );
    },
    [items],
  );

  const decrement = useCallback((sessionProductId: string) => {
    setItems((prev) =>
      prev.map((row) =>
        row.sessionProductId === sessionProductId
          ? { ...row, qty: Math.max(row.minOrder, row.qty - 1) }
          : row,
      ),
    );
  }, []);

  const remove = useCallback((sessionProductId: string) => {
    setItems((prev) =>
      prev.filter((row) => row.sessionProductId !== sessionProductId),
    );
  }, []);

  const clear = useCallback(() => setItems(EMPTY), []);

  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  const { subtotal, count } = useMemo(() => {
    let subtotal = 0;
    let count = 0;
    for (const row of items) {
      subtotal += row.price * row.qty;
      count += row.qty;
    }
    return { subtotal, count };
  }, [items]);

  const value = useMemo<CartContextValue>(
    () => ({
      items,
      add,
      increment,
      decrement,
      remove,
      clear,
      subtotal,
      count,
      drawerOpen,
      openDrawer,
      closeDrawer,
    }),
    [
      items,
      add,
      increment,
      decrement,
      remove,
      clear,
      subtotal,
      count,
      drawerOpen,
      openDrawer,
      closeDrawer,
    ],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

function useCartContext(): CartContextValue {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error("useCartContext must be used within a CartProvider");
  }
  return context;
}

export { CartProvider, useCartContext };
