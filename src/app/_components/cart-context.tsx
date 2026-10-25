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

const STORAGE_KEY = "fs-cart";

export type CartItem = {
  sessionProductId: string;
  itemId: number;
  name: string;
  sku: string;
  price: number;
  minOrder: number;
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
  const [items, setItems] = useState<CartItem[]>(loadCart);

  useEffect(() => {
    saveCart(items);
  }, [items]);

  const add = useCallback((item: CartItemInput, qty: number) => {
    const normalizedQty = Math.max(item.minOrder, Math.floor(qty));
    setItems((prev) => {
      const existing = prev.find(
        (row) => row.sessionProductId === item.sessionProductId,
      );
      if (!existing) {
        return [...prev, { ...item, qty: normalizedQty }];
      }
      return prev.map((row) =>
        row.sessionProductId === item.sessionProductId
          ? { ...row, qty: row.qty + normalizedQty }
          : row,
      );
    });
  }, []);

  const increment = useCallback((sessionProductId: string) => {
    setItems((prev) =>
      prev.map((row) =>
        row.sessionProductId === sessionProductId
          ? { ...row, qty: row.qty + 1 }
          : row,
      ),
    );
  }, []);

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
    () => ({ items, add, increment, decrement, remove, clear, subtotal, count }),
    [items, add, increment, decrement, remove, clear, subtotal, count],
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
