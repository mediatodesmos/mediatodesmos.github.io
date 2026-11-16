# Media to Desmos — Design System

This design system copies the visual language of the Vertex landing page (https://vertex-one-lovat.vercel.app/, built on the Ruixen UI template). The UI-replication agent took the values below from computed styles on the live site. We copy the look only. Branding, copy and content are our own.

## 1. Vibe

- Dark, flat, monochrome UI. The near-black charcoal canvas has soft off-white text, plus one accent blue for status and selection.
- Content sits inside a thin "blueprint" frame: two vertical rails down each side, 4-8px apart. Dashed dividers separate the sections.
- A 40px diagonal-hatch strip separates the major blocks. Small "+" crosshair marks sit where lines meet.
- Big serif display headings sit over a clean sans body.
- No glass, glow, grain or blur. Depth comes only from borders, the stacked-card mockup and the occasional `shadow-xl`.
- Our product outputs black-and-white graphs, so the monochrome frame suits it.

## 2. Color tokens (dark is the only theme)

| Token | Value | Use |
|---|---|---|
| `--bg` | `#121212` | page background |
| `--card` | `#191919` | cards, popovers, panels |
| `--muted` | `#212121` | active chips, segmented track |
| `--accent` | `#2b2b2b` | hover fills |
| `--footer` | `#000000` | footer |
| `--border` | `#242424` | all borders and inputs |
| `--fg` | `#ebebeb` | body text |
| `--fg-strong` | `#fafafa` | card titles, numbers |
| `--fg-muted` | `#9b9b9b` | secondary text, icons |
| `--fg-faint` | `#a3a3a3` | footer column headings |
| `--primary` / `--primary-fg` | `#fafafa` / `#171717` | primary buttons |
| `--ring` | `#8c8c8c` | focus ring (3px at 50%) |
| `--blue` | `#3b82f6` | the single accent: selection, highlight, "new" pills |
| `--danger` | `#ef4444` | errors |

- Card tint: `linear-gradient(55deg, rgba(56,144,255,.10), rgba(56,144,255,.04) 35%)`.
- Dot grid: `radial-gradient(circle, #ebebeb 1px, transparent 1px)` at 3% opacity.
- Hatch strip: `repeating-linear-gradient(315deg, rgba(255,255,255,.1) 0 1px, transparent 0 50%)`, background-size 10px.
- Edge fades: `linear-gradient(to right, var(--bg), transparent)` on marquees and the bottoms of mockups.
- Shadows: none by default.
  - `shadow-sm` on small cards and the segmented pill.
  - `shadow-xl` (`0 20px 25px -5px rgba(0,0,0,.1), 0 8px 10px -6px rgba(0,0,0,.1)`) on the stacked hero cards.

## 3. Typography

- Sans: **Geist** (variable 100-900). Mono: **Geist Mono** (used for LaTeX and numbers).
- Display: Vertex uses the paid Tiempos Headline. Our substitute is **Newsreader** (Google Fonts, opsz 6-72, wght 600), falling back to Georgia.

| Role | Spec |
|---|---|
| H1 | serif 600; 36px mobile, 48px md, 60px lg; line-height 1.0; tracking -0.025em; `text-wrap: balance` |
| H2 | serif 600; 36px/40px; centred; balanced; often ends with a period |
| H3 card title | Geist 600; 14px mobile, 18px lg; tracking -0.45px |
| H4 feature title | Geist 600; 14px/20px |
| Lead | Geist 400; 16px mobile, 18px md; 28px line-height; muted; max-width 42rem |
| Body | 16px/24px |
| Small / xs | 14px/20px; 12px/16px |
| Button | Geist 500 14px; header buttons 12px |
| Overline | 11px 600 uppercase; tracking .05em; muted |
| Stat | Geist 600; 30px lg, 36px xl; `tabular-nums`; 1px left border at fg/40%; 16px left padding |

## 4. Layout

- Container: responsive, following Tailwind's container steps (640 / 768 / 1024 / 1280 / 1536px). At a 1440px window Vertex is 1280px wide. Header and footer are full width; the workspace screens go full width ("wide mode").
- Frame: the outer wrapper has a 1px left/right border. An inner wrapper is inset 4px (6px sm, 8px lg) with its own 1px left/right border, giving the double rail.
- Sections: `py-16 md:py-24` (64/96px). Sections are separated by `1px dashed var(--border)`. The hero adds 96-128px of top padding.
- Spacing scale: 4px base, mostly 8/12/20/24px gaps.
- Radii: 6px buttons and nav items, 8px base, 10px chips and segmented pills, 12px cards, 16px large mockups, 999px badges.
- Header: sticky, 64px tall, solid background, bottom border at 40% opacity.
  - Left: logo mark plus "Media to Desmos" (Geist 600, 18-20px).
  - Centre: nav.
  - Right: GitHub icon and the light primary CTA (32px tall, 12px text).
- Footer: pure black, at least 40svh.
  - Logo on the left, then a 3-column grid of link groups. Group headings are serif 14px in `--fg-faint`; links are 14px.
  - Bottom row: legal text and a "not affiliated with Desmos Studio" note.

## 5. Components

- **Primary button:** `#fafafa` background, `#171717` text, 40px tall, 0 24px padding, 6px radius, 500 14px, `transition: all 150ms cubic-bezier(.4,0,.2,1)`. Pressed state `scale(.98)`.
- **Outline button:** `rgb(36 36 36 / .3)` background, 1px `#242424` border, light text.
- **Card button:** `#191919` background, 1px ring at fg/10%, `shadow-sm`, 32px tall, 12px text.
- **Ghost button:** transparent; hover `--accent`.
- **Focus:** `box-shadow: 0 0 0 3px rgb(140 140 140 / .5)`.
- **Badge:** 999px radius, 1px border, card background, padding 4px 12px 4px 8px, 500 12px muted, with a small leading icon.
- **Tab chips:** 10px radius, 1px border, padding 5px 11px 5px 9px, 14px text with an icon.
  - Inactive: muted text. Active: `--muted` background with fg text. Hover: muted at 60%.
  - Chips sit in a pill tray with a card background.
- **Segmented toggle:** wrapper `--muted` with 2px padding and 12px radius, equal grid columns.
  - The sliding pill uses `--bg`, 10px radius and `shadow-sm`, with `transform 500ms ease-in-out`.
  - Buttons: 8px 20px padding, 14px text.
- **Card:** 12px radius, 1px border, card background, overflow hidden. The tint variant adds the blue gradient.
- **Stacked mockup:** four cards (16px radius, border fg/15%, `shadow-xl`). The back cards are scaled 0.95, 0.9 and 0.85 and offset -32px each, so they peek out above. The active chip brings its card to the front.
- **Logo/format cloud:** a 5×2 grid with 1px cell borders and "+" crosshairs at the corners.
- **Stats:** a 2×2 grid of stat blocks.
- **FAQ:** a category rail on the left and an accordion on the right.
  - Items have a bottom border and 28px vertical padding. Questions are 16px 600, and drop to 70% opacity on hover.
  - The open/closed marker reproduces Vertex's `[+]` / `[-]` look, drawn as a custom SVG (brackets plus plus/minus strokes), never as text glyphs.
- **Mega-menu style lists:** a 36px square icon box (border fg/5%, background `--bg`) beside a 14px title and a muted one-line description. Hover background fg/3%.

## 6. Icons

- Custom hand-drawn inline SVG only: a 24-unit grid, 1.75 stroke, round caps and joins, `currentColor`, usually muted. Headers use stroke 2 and chevrons 2.5.
- **Never** use emoji or unicode symbol glyphs as icons. This is the most important rule.

## 7. Motion

- Default transition: 150ms `cubic-bezier(.4,0,.2,1)`. Colour transitions on chips and toggles take 300ms.
- Keyframes: `fade-in-up` (20px rise plus fade), `fade-in`, `scale-in`, `slide-in-x`, `scroll-left`/`scroll-right` (marquee to -50%), `orbit`/`counter-orbit`, and the accordion height animation.
- Dialogs and popovers enter by scaling from .96 with a 4px rise.
- Respect `prefers-reduced-motion`: disable marquees, orbits and entrance animations.

## 8. Responsive (375px)

- The nav collapses to logo plus hamburger. The menu opens a full-screen sheet with "Menu" in the serif, divider-separated rows, and a full-width primary CTA.
- H1 drops to 36px. Hero buttons stay side by side.
- The chip tray scrolls horizontally. Grids collapse to one column (two for the format cloud). The frame rails stay at a 4px inset.
- Workspace: the three columns become tabs (Settings / Graph / Equations).

## 9. How our screens map onto Vertex patterns

| Vertex section | Media to Desmos |
|---|---|
| Hero (badge, H1, lead, CTAs, stacked mockup + chips) | Home hero: drop zone + sample conversions in the card stack (Outline / Fill / Fourier / Video) |
| Logo cloud | Supported inputs and outputs grid |
| "Everything you need" + app mockup | How it works (Analyze, Trace, Fit, Paste) |
| 3-col feature cards | Inspector, mass export, video slider graph, Fourier, live webcam, projects |
| Stats grid | Facts about the engine, all true and checkable |
| FAQ (category rail + accordion) | FAQ: General / Export / Video |
| Final CTA + orbit rings | "Drop a file" CTA with orbiting format chips |
| App mockup | Convert workspace (settings, Desmos graph, equation inspector) |
