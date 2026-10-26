"use client";

import { useEffect, useState } from "react";

/**
 * Returns `value` after it has stopped changing for `delayMs`.
 *
 * Extracted from the product picker's hand-rolled `setTimeout` debounce
 * (spec: keep 300 ms, give it a name). Now it guards the client-side
 * catalog filter instead of a network call — cheap work, so the UI stays
 * responsive while typing.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);

  return debounced;
}
