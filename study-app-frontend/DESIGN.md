# Studae Design System

The source of truth for how Studae looks and feels. Tokens are implemented in
[src/lib/theme.ts](src/lib/theme.ts) — this document explains the intent behind them so new
screens stay consistent. When code and this doc disagree, `theme.ts` wins; update this doc to match.

## Aesthetic

Warm paper / notebook. Studae should feel like a calm, trustworthy study companion, not a
neon SaaS dashboard. Think: a clean exercise book on a desk under warm light. Studious,
focused, a little handcrafted (handwritten headers), never loud. Every screen earns calm:
one clear primary action, generous spacing, few colors.

Classifier: **App UI** (workspace/task-focused), not a marketing page. Apply App UI rules:
calm surface hierarchy, dense-but-readable, minimal chrome, utility copy, one accent.

## Color

One accent (blue). Everything else is warm neutrals. Light is the locked design; dark mirrors
it (paper → charcoal, ink → warm white) preserving the same accent. Full palettes live in
`theme.ts` (`LIGHT` / `DARK`); use `const C = useTheme()` so components react to dark mode.

| Token | Light | Role |
|-------|-------|------|
| `paper` | `#eceadf` | screen background |
| `paper2` | `#e4e1d4` | secondary background |
| `card` | `#fbfaf6` | primary card surface |
| `card2` | `#f3f1ea` | inset / thumbnail surface |
| `ink` | `#2a2823` | primary text |
| `ink2` | `#6f6a5c` | secondary text / metadata |
| `ink3` | `#9a9486` | tertiary / placeholder |
| `line` | `#bdb6a4` | borders (2px) |
| `accent` | `#3a5ba0` | the single accent — links, soft accents, small marks/icons |
| `accentD` | `#2b457c` | the deeper accent — FILLED surfaces that carry white text |
| `accentSoft` | `#e2e8f4` | accent backgrounds (soft), with dark `accentInk` text |
| `ok` / `warn` / `err` | green / amber / rust | status only, each with a `*Soft` bg |

Rules:
- One accent. Do not introduce a second hue for emphasis; use weight (filled vs soft) instead.
- **Filled-blue surfaces carrying white text use `accentD`, not `accent`.** White on `accent` (`#3a5ba0`) is only ~6.5:1 and thin/handwriting glyphs read as faded; white on `accentD` (`#2b457c`) is ~9:1 and crisp. Applies to `Button` kind `pri`, the Home Teach banner tile, chat `MeBubble`, the Composer send button — pair the `accentD` fill with a `C.ink` border. (`accent` itself stays for links, the logo dot, soft backgrounds, and small marks where it sits on light surfaces.)
- Borders are 2px in `line` or `ink`, not hairlines. It's part of the handcrafted feel.
- Never body text below 16px-equivalent or contrast under 4.5:1. (white-on-`accentD` ≈ 9:1; ink-on-cream ≈ 13:1.)

## Typography

Two families, no more.
- **Display / headers / hero numbers:** Kalam (handwritten). `F.hand` = `Kalam_700Bold`. Used
  for greetings, section titles (handH2/handH3), and big stat numbers ONLY. Not body.
- **Body / UI:** system sans (utility, highly legible). Used for everything readable.

T variants (see `components/ui/T.tsx`): `handH2` (22), `handH3` (19) for titles; `bodyB` (14, bold),
`body`, `small` (12), `mut` (11, uppercase label), `note`. A global `textScale` (1.0 default,
1.18 "larger text") multiplies every size for accessibility — design must survive 1.18x.

## Shape & spacing

Radii (`R`): sm 6, md 10, lg 14, xl 18, pill 999. Cards use lg (14). Icon tiles use md (11).
Avatars/pills use pill. Spacing is generous and consistent; lean on `Row`/`Col`/`Card` gaps
rather than ad-hoc margins.

## Component vocabulary (reuse, don't reinvent)

- `Card` (`kind`: `soft` | `accent` | `fill`) + `Row` / `Col` / `Divider` — the layout spine.
- `Button` (`kind`: `pri` | `soft` | `ghost`; `size`: sm/md/lg) — actions.
- `T` — all text, via variants above. `Badge`, `Chip`, `Ring`, `Bar`/`Stat`, `Segmented`.
- `Screen` (scroll + pull-to-refresh), `AppBar`, `ConfirmSheet` (all confirmations — never a
  system Material alert), `Skeleton` (loading), `DocThumb`.

New UI should be a composition of these. A genuinely new primitive needs a reason.

## Patterns

### Primary-action banners (Home hero)
The "Teach me" / "Ask anything" hero on Home (the wedge's front door):
- Equal-size two-up pair (`Row`, each `Card` flex:1). Teach = `accent`-filled (primary),
  Ask = `card`/soft (secondary). Hierarchy by color weight, not size.
- Collapses to stacked full-width when `largerText` is on.
- Teach label is adaptive: "Teach me" → "Continue · Topic N" → "Review" based on lesson state.
  Subtitle always names the real chapter (the trust moment: proves we read their material).
- Each banner is `accessibilityRole="button"` with a full label, ≥56px tall.
- Placement is context-adaptive: when an exam date (focus area) is set, the NEXT EXAM
  countdown is the hero and banners sit below; otherwise the banners are the top hero.

## Anti-slop guardrails (what Studae is NOT)

No purple/indigo gradients. No 3-column icon-in-circle feature grid. No centered-everything.
No decorative blobs or emoji-as-UI. No system font as the *display* face (Kalam owns display).
Cards only when the card is the interaction. If a section feels empty, it needs better content,
not decoration. If deleting 30% of the copy improves it, keep deleting.

## Accessibility (non-negotiable)

Dark mode (full `DARK` palette). Larger-text mode (1.18x) — layouts must reflow, not truncate.
Touch targets ≥44px. Contrast ≥4.5:1 on body text. Screen-reader labels on every actionable
element (not just an icon). Confirmations via `ConfirmSheet`, never silent.
