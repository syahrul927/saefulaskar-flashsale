import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Runtime TypeError, 2026-11-08 (Turbopack, Next 15.5): importing
// `@phosphor-icons/react`'s MAIN entry from a module without `"use client"`
// crashes at module evaluation — the main entry re-exports every `csr/*`
// icon, each importing `lib/IconBase.es.js`, which imports
// `lib/context.es.js`, which calls `React.createContext` at module scope.
// The react-server condition does not export `createContext`, so the module
// graph fails before any component renders. The `/ssr` entry has no context
// (that is why `button.tsx` imports `@phosphor-icons/react/ssr` — its header
// comment says exactly this).
//
// This test pins the class, not the one file: every `src/components/ui/*`
// module that lacks `"use client"` must not pull the main entry (directly or
// via another ui module). Server components legitimately import these ui
// files (admin orders page → pagination, admin products page → badge), so a
// future icon import from the main entry in a directive-less ui module is a
// re-run of this exact crash.
const UI_DIR = "src/components/ui";

function firstLine(path: string): string {
  return readFileSync(path, "utf8").split("\n", 1)[0] ?? "";
}

function isClientComponent(path: string): boolean {
  return firstLine(path).includes("use client");
}

/** All files in the ui dir missing the directive. */
const serverUiFiles = readdirSync(UI_DIR)
  .filter((f) => f.endsWith(".tsx"))
  .map((f) => join(UI_DIR, f))
  .filter((f) => !isClientComponent(f));

describe("directive-less ui modules never import the phosphor main entry", () => {
  it.each(serverUiFiles)("%s stays free of @phosphor-icons/react main", (file) => {
    const source = readFileSync(file, "utf8");
    // Main entry only — the `/ssr` subpath is the RSC-safe entry and is fine
    // (it is what button.tsx uses).
    const mainEntry = /from "(?!\.)@phosphor-icons\/react(?![\w/])"/;
    expect(source).not.toMatch(mainEntry);
  });
});
