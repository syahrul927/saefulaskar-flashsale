# Read this if you are AI Agent

- Use English
- Use `/brainstorming` when asked to **create a new feature** that lacks detail or requirements are ambiguous (what should this feature do? what's the scope?). This is for product/requirements ambiguity, not visual structure.
- Use `/frontend-design:frontend-design` whenever the task touches UI **structure or visual treatment** — designing/redesigning a layout, card, list, table, row, stat block, or tab; reordering columns; adding status indicators or dots; making something "more scannable" / "better hierarchy" / "redesign this". Invoke it BEFORE writing markup, even if the task feels like a small tweak — it is the default for any visual-structure change. Only reach for `/brainstorming` first when you genuinely don't know WHAT to build, not when you're deciding HOW a known thing should look.
- Use `/systematic-debugging` when asked to fix an issue or bug — always find root cause before proposing fixes.
- Before running any git operation on the `main` branch (commit, push, merge, rebase), confirm with your human partner first.
- Never run `pnpm db:push` or `pnpm db:migrate`. Only `pnpm db:generate` is safe. Ask your human partner to apply migrations manually.
- Always use yarn instead of npm, pnpm or bun.
- Base components are shadcn in `src/app/_components/ui/`. Reuse those before writing new ones. Match shadcn look/style — use existing components when building visual companions or UI for the user.
- New dashboard pages wrap their content in the standard page padding (`flex-1 space-y-6 p-4 md:p-6` or `p-6`) — match the sibling pages, not a bare unstyled div.

## Perceived Performance & Feedback

The app must never _feel_ slow. The rules below are the concrete ways to hit that — apply them by default on any interactive UI.

- **Loading state on every API-triggered button.** Any button that fires an API call must set `isLoading` until the request resolves (success or error). The base `Button` (`src/app/_components/ui/button.tsx`) already renders a spinner and disables itself while `isLoading` is `true` — use it, don't hand-roll. Disabling while in-flight also prevents double-submits.
- **Navigate instantly, never block on data.** Page transitions happen the moment the user acts — never hold on a blank or frozen screen while data loads. Render `Skeleton` placeholders (`src/app/_components/ui/skeleton.tsx`, via `loading.tsx` / Suspense boundaries) for any component whose data isn't ready yet.
- **Every action gets visible feedback.** Both success and failure of a user action must surface a `sonner` toast (`src/app/_components/ui/sonner.tsx`). Success confirms the action landed; failure states what went wrong. (The Radix `toast`/`use-toast` stack is legacy — prefer `sonner` for new work.)
