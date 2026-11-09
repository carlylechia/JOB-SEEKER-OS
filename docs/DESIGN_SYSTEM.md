# Interface system — teChia Jobs

This document covers the visual and layout system introduced with the dashboard
UX release: self-hosted typography, the lime/charcoal/sand palette, the sticky
application shell, the branded loading experience and the 404 page.

It is intentionally narrow. The product does **not** have a general-purpose
component library; these are shared tokens and a few structural primitives.

---

## 1. Typography

Two typefaces, both self-hosted from `src/app/fonts/` and loaded through
`next/font/local` in `src/app/layout.tsx`:

| Role | Face | Weights | Why |
|---|---|---|---|
| Display | **Fraunces** variable (SOFT axis) | 100–900 | Expressive, softly curved serifs for page titles, brand moments and the loader wordmark. |
| Body | **Inter** | 400 / 500 / 600 / 700 | Highly legible at the small sizes used by tables, forms, filters and dense navigation. Already bundled for resume preview. |

Both under the SIL Open Font License; license files are committed alongside the
WOFF2 files (`FRAUNCES-OFL.txt`, `INTER-OFL.txt`). No runtime request is made to
Google Fonts, so there is no third-party font dependency, no extra DNS/TLS
handshake and no font-driven layout shift beyond the local `font-display: swap`.

`--font-display` is applied to `h1`, `h2`, `.font-display` and `.title` only.
`h3`–`h6`, buttons, inputs, tables and navigation explicitly use
`--font-body`, so dense UI never becomes harder to scan.

Tailwind tokens:

```ts
fontFamily: {
  sans:   ['var(--font-body)', ...],
  display:['var(--font-display)', ...],
  body:   ['var(--font-body)', ...],
}
```

---

## 2. Palette and the 60:30:10 rule

Tokens live in `src/app/globals.css` as raw RGB channel triplets so Tailwind's
alpha syntax (`bg-card/60`, `border-line/20`) keeps working in both themes.

| Share | Role | Light | Dark |
|---|---|---|---|
| 60% | Canvas | `#F7F8F3` warm off-white | `#191D1B` charcoal |
| 30% | Panels | `#FFFFFF` card, `#EEF0E9` sidebar | `#202522` card, `#1C211E` sidebar |
| 10% | Accent | `#B7F34A` acid lime | `#A6E635` rich acid lime |

Supporting text:

| Token | Light | Dark |
|---|---|---|
| `ink` | `#151715` jet black | `#ECEFEA` |
| `ink-2` | `#343A35` dark grey | `#D8CDB6` sand |
| `muted` | `#646C61` | `#A5AEA5` |
| `accent-text` | `#4F6B14` (lime as readable text) | `#C7F77A` |

The accent is never used as a large fill. It is reserved for primary actions,
active navigation, selection highlights, focus and a small number of status
treatments. Labels on the lime fill use `accent-ink` (`#151715`), which is
13.7:1 in light mode; using white on lime would fail contrast.

`tests/ui-system.test.ts` asserts the important foreground/background pairs stay
at or above WCAG AA (4.5:1) and fails if a token drifts.

### Ambient canvas

The canvas is layered rather than flat:

- two very low-opacity radial washes (lime + sand) on `--page-bg`
- a faint 72px graph-paper grid from `--grid-line`
- a fixed, 6.5% (light) / 4.5% (dark) workspace photograph behind the content
- a reusable `.ambient-canvas` applied to the app, admin, auth and marketing shells
- decorative `.ambient-orb` / `.dot-field` helpers for the loader and 404

The workspace photo is a local, cropped WebP (`public/backgrounds/weekly-planning.webp`,
54 KB) and is credited in `public/backgrounds/CREDITS.md`. It is painted by a
`pointer-events: none` pseudo-element at `z-index: -1`, so it never intercepts
clicks. Because the theme palette stays opaque and the photo sits at a whisper
of opacity, text contrast is unchanged in both themes.

Marketing pages (`(marketing)/layout.tsx`) share this canvas. Public pages must
not paint an opaque page-level background over it; sections, cards and the
footer keep their own surfaces so the photo only shows through the canvas.

All decorative layers are painted with CSS backgrounds or `pointer-events:
none` containers. They sit behind content, never intercept clicks and do not
reduce text contrast.

---

## 3. Sticky application shell

The frame is deliberately a normal document-scrolling container:

```
<div class="ambient-canvas flex min-h-dvh overflow-x-clip">
  <aside class="fixed inset-y-0 left-0 h-dvh ...">   ← viewport-pinned column
    logo
    <div class="min-h-0 flex-1 overflow-y-auto">nav</div>
    <div class="shrink-0 border-t">account + sign out</div>
  </aside>
  <div class="flex min-w-0 flex-1 flex-col lg:pl-72">  ← matches the 18rem rail
    <header class="sticky top-0 z-40 ...">topbar</header>
    <main>page content</main>
  </div>
</div>
```

Key rules:

- The topbar is `position: sticky`, so it remains in the viewport without taking
  the document out of normal scrolling.
- The sidebar is `position: fixed` to the viewport with `inset-y-0`; the scroll
  column is offset by `lg:pl-72`, exactly matching its `w-72` width, so the
  sidebar can never drift or leave empty space on the left.
- Only the sidebar navigation scrolls internally (`overflow-y-auto` with
  `min-h-0 flex-1`), so a short viewport can never push the account footer or
  sign-out button off screen.
- The app frame clips only the inline axis (`overflow-x-clip`). Block-axis
  `overflow: hidden` or a fixed `h-screen` on an ancestor would create a
  scrollport and silently break the sticky topbar.
- Mobile navigation is unchanged; the sidebar is hidden below `lg` and the
  offset resets.
- Admin uses the same sticky header treatment on top of the ambient canvas.

---

## 4. Branded loader

`src/components/shared/brand-loader.tsx` provides two variants:

- `full` — the default route/panel moment. Real `BrandMark`, a single orbiting
  lime arc, the teChia Jobs wordmark and a progress rail.
- `inline` — compact companion for buttons, cards and in-place fetches.

Route boundaries exist at the root, `(app)`, `admin` and `(auth)` levels.
In-page fetches that previously showed plain text (for example daily jobs) use
the same loader, so the brand moment is consistent.

Implementation notes:

- Only `transform` and `opacity` animate. No layout properties are animated.
- `role="status"` / `aria-live="polite"` announce loading without trapping focus.
- `prefers-reduced-motion` replaces the animations with a still frame and a
  static progress fill.
- It renders the real SVG mark; there is no generic spinner-only state.

---

## 5. 404 page

`src/app/not-found.tsx` is a global not-found boundary. Next.js still returns
HTTP **404** for unknown routes; the file changes only the presentation.

- Brand mark and oversized display numeral
- Auth-aware primary action: **Back to dashboard** when signed in, **Back to
  home** otherwise
- History-aware **Go back** button (`BackButton`) that falls back to the primary
  destination when there is no meaningful history entry
- Decorative ambient field behind the content, marked `aria-hidden`
- `robots: noindex, nofollow`

---

## 6. Accessibility checklist

- Contrast pairs are asserted in code (`tests/ui-system.test.ts`).
- Theme selection persists and applies before first paint via the existing
  `themeInitScript`.
- All decorative motion collapses under `prefers-reduced-motion`.
- Sticky navigation keeps a visible focus target and does not hide content
  behind the topbar (`scroll-padding-top` remains set).
- The loader and 404 use semantic landmarks/status roles; decorative elements
  are hidden from assistive technology.
