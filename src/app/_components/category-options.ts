/**
 * Fixed category list for the roster dropdowns (plan D: union rule).
 * `sessionProducts.category` is free-text and nullable, so legacy values must
 * stay selectable — `categoryOptions` merges them after the defaults.
 */
export const CATEGORY_OPTIONS = [
  "Minuman",
  "Fashion",
  "Elektronik",
  "Rumah Tangga",
] as const;

/**
 * Default categories plus every distinct non-null category already present on
 * the roster, in first-seen order, skipping ones the defaults already list.
 */
export function categoryOptions(existing: (string | null)[]): string[] {
  const options: string[] = [...CATEGORY_OPTIONS];
  const seen = new Set<string>(options);
  for (const value of existing) {
    if (!value) continue;
    if (!seen.has(value)) {
      seen.add(value);
      options.push(value);
    }
  }
  return options;
}
