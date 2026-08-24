# DESIGN.md — Equals (equals.com)

> Independent design-system analysis based on direct inspection of equals.com (live site, not the paid getdesign.md report). All values below were read from actual computed styles and screenshots — colors, font sizes, and spacing are the real production values, not estimates.

## 1. Brand Summary

Equals is an AI-powered spreadsheet/BI product for finance and RevOps teams ("AI for the numbers that can't be wrong"). The visual language pairs a **literary, editorial serif** for headlines with a **clean grotesk sans** for UI/body text, on a warm off-white canvas. It borrows credibility cues from print/finance publishing (large serif type, red negative numbers, approval stamps) while staying light and modern (pastel gradient pixel-blocks, a single saturated orchid-purple accent, generous whitespace).

Keywords: *trusted, editorial, calm, precise, spreadsheet-native, understated-playful.*

## 2. Color Palette

| Token | Hex / RGB | Usage |
|---|---|---|
| Background (base) | `rgb(250, 249, 245)` / `#FAF9F5` | Page background — warm off-white, not pure white |
| Foreground (text) | `rgb(0, 0, 0)` / `#000000` | Headlines, body copy |
| Secondary text | Cool grey (~`#7A7A78`) | Sub-headlines, muted copy (e.g. "Build once, iterate for years.") |
| Accent — Orchid (primary) | `rgb(176, 116, 206)` / `#B074CE` | Primary CTA buttons, links, hover states — the single saturated brand color |
| Accent — Amber/Red-orange (label) | ~`#FF5A36` (estimated from screenshot; body carries class `label--amber`) | Numbered section eyebrows ("1. TRUST", "2. BUILD"), small caps labels |
| Decorative gradient — Lavender | `#D8C5EC` → `#F3ECFA` | Pixel-block decorative strips (hero sides) |
| Decorative gradient — Aqua/Teal | `#8FE0E0` → `#E4F8F6` | Pixel-block decorative strips (hero sides) |
| CTA-section background | Light orchid tint (~`#EFE3F5`) | Full-bleed background for closing CTA + footer |
| Negative financial values | Red (~`#D64545`) | Spreadsheet screenshots — churn, contraction figures |
| Positive financial values | Default black/green | Spreadsheet screenshots — gross new, expansion |

**Brand system naming** (found in `<body class="accent--orchid label--amber">`): the design system itself names its accent **"orchid"** (purple) and its label color **"amber."** Reuse these token names if rebuilding.

The palette is deliberately restrained: one neutral background, one accent color for interactive elements, one secondary accent for labels, and soft multi-hue gradients used *only* as decoration (never on text or UI controls).

## 3. Typography

| Role | Font Family | Size | Weight | Line-height | Letter-spacing |
|---|---|---|---|---|---|
| H1 (hero headline) | `"Serrif Condensed", serif` | `110px` | `400` | `110px` (1:1, tight) | `-2.2px` |
| H2 (section headline) | `"Serrif Condensed", serif` | `48px` | `400` | `50px` | `-0.48px` |
| Body / UI | `Unica77, sans-serif` | `18px` (body), `16px`/`14px` (buttons) | `400` | `24px` | `-0.09px` |
| Section eyebrow label | Monospace (system mono) | small (~`12–13px`) | `400–500` | — | wide tracking, `UPPERCASE` |

**Font pairing logic:**
- **Serrif Condensed** (a custom/licensed serif with ligatures — note the joined "ct" and stylized apostrophe visible in "can't be wrong") carries all headlines. It reads as literary/editorial, not corporate — the opposite of typical SaaS sans-heavy hero type.
- **Unica77** (a Swiss/grotesk sans) handles everything functional: nav, buttons, body copy, spreadsheet UI. High legibility, neutral character.
- A **monospace** face is reserved exclusively for the small numbered section eyebrows ("1. TRUST", "2. BUILD", "3. DEPLOY", "4. FOUNDATIONS", "5. TESTIMONIALS") — this is the one place the design gets a technical/data texture.
- Headline line-height is essentially 1:1 with font-size (very tight), which only works because the serif has restrained x-height and ligatures — replicate carefully with fallback fonts.

**Fallback stack recommendation** (since Serrif Condensed is proprietary):
```css
--font-display: "Serrif Condensed", "Canela", "Tiempos Headline", Georgia, serif;
--font-body: "Unica77", "Suisse Int'l", "Inter", -apple-system, sans-serif;
--font-mono: "Unica77 Mono", "IBM Plex Mono", ui-monospace, monospace;
```

## 4. Layout & Spacing

- **Container**: centered, generous side margins (~`123px` on 1512px viewport ≈ 8% gutters), content max-width appears to sit around `1240–1280px`.
- **Section rhythm**: each major section is preceded by a numbered monospace eyebrow (`N. LABEL`) in the amber/orange accent, followed immediately by a two-line headline: **line 1 in black** (the claim), **line 2 in grey** (the elaboration) — same font/size, only color differs. This black→grey two-line headline pattern repeats in every major section and is a core signature of the system.
- **Vertical spacing**: sections are very tall — large empty padding (200px+) between the headline block and the content/screenshot below it. The design is unhurried; whitespace is used as a trust signal.
- **Grid**: feature sections use a 2-column or 3-column grid (e.g. the three testimonial-prompt columns, the 2×2 "Deploy" feature cards) with a thin `1px` hairline border/divider (`var(--line)`-equivalent) separating columns, echoing spreadsheet cell borders.
- **Product screenshots**: framed in white cards with soft shadow, rounded corners (~`8–12px`), never full-bleed — they sit inset within the section, always accompanied by a small chat/Slack-style panel alongside for context.

## 5. Components

### Buttons (primary CTA)
```
background: #B074CE (orchid)
color: #FFFFFF
border-radius: 60px        /* full pill */
padding: 12px 18px         /* hero size */
padding: 4px 12px          /* compact/nav size */
font: Unica77, 16px/14px, weight 400
border: none
```
Fully rounded pill shape at every size — this is the only place a saturated color appears as a fill.

### Email capture input + button (combined pill)
A single pill-shaped container: white/translucent input field seamlessly joined to the orchid "Get a demo" button, both sharing one `border-radius: 60px` outer shape. Placeholder text in muted grey ("Enter your work email").

### Navigation
- Flat, minimal top bar on the base background (no shadow, no border by default)
- Logo mark: a simple "=" (equals sign) glyph + wordmark "Equals" in the serif or a bold sans
- Text links (Use cases, Pricing, About) in black, no underline by default
- "Sign in" as plain text link; "Get a demo" as the sole filled pill button — classic single-CTA nav pattern

### Section eyebrow / label
```
font: monospace, uppercase
color: amber/orange (~#FF5A36)
letter-spacing: wide
format: "{number}. {LABEL}"   e.g. "2. BUILD"
```

### Two-line section headline
```
Line 1: color #000, serif, section-headline size
Line 2: color grey (~#7A7A78), same serif/size — the "subhead as second line" pattern
```

### Data/spreadsheet UI cards (product screenshots)
- White background, `1px` hairline border, subtle drop shadow, rounded corners
- Toolbar row with icon buttons (bold/italic/underline/alignment/number-format) — mimics real spreadsheet chrome
- Tab bar along the bottom with small colored icons per sheet ("Daily Pulse," "Summary," "Pipeline Pacing"), active tab underlined
- Financial tables: right-aligned numbers, red parentheses for negative values, bold row for totals — standard finance-spreadsheet convention, intentionally preserved rather than "prettified"

### Testimonial rows
- No card/box — plain content on the page background, separated by thin horizontal hairlines
- Large quote text (serif or large sans, ~`24px`) in black
- Small circular headshot + name (bold) + title (grey) to the right
- Company wordmark/logo beneath the attribution

### Decorative gradient blocks
- Small rectangular pixel/bar-chart-like blocks in lavender and aqua gradients, placed asymmetrically along the hero's left/right edges and repeated in the closing CTA section
- Never used behind text — purely peripheral ornamentation that echoes "data visualization" without being literal

### Footer
- Full-bleed light-orchid background band shared with the closing CTA (no hard section break)
- Three-column simple link list: **GUIDES / RESOURCES / COMPANY**
- Column headers: small grey uppercase labels; links: black, regular weight, no bullets/icons
- No newsletter form, no social icon row beyond the links listed under Company

## 6. Imagery & Iconography

- **Isometric line illustrations**: single-color (black stroke on light-lavender fill) 3D isometric diagrams used to explain abstract concepts (e.g. the "Foundations/warehouse" section) — hand-drawn feel, not photographic, not 3D-rendered
- **Product screenshots** are real UI captures (not staged mockups), reinforcing the "trust the actual numbers" positioning
- **Chat/Slack UI reproductions** appear directly in marketing sections — a distinctive choice that shows the product living inside existing tools rather than only as a standalone app
- Customer logos rendered in flat black/monochrome, evenly sized, arranged in a horizontal marquee under the hero

## 7. Voice & Motion (inferred)

- Copy is short, declarative, confident: "Build expert workbooks. Trust every answer. Run it everywhere." — three fragments, no filler.
- Section headlines follow a strict **claim → elaboration** two-liner formula throughout, giving the whole page a consistent editorial cadence.
- No visible aggressive motion/parallax in static capture; the design relies on typographic contrast and whitespace pacing rather than animation for its sense of quality.

## 8. Suggested CSS Custom Properties

```css
:root {
  /* Color */
  --color-bg: #FAF9F5;
  --color-fg: #000000;
  --color-fg-muted: #7A7A78;
  --color-accent-orchid: #B074CE;
  --color-accent-amber: #FF5A36;
  --color-cta-bg: #EFE3F5;
  --color-negative: #D64545;
  --color-line: #E5E2DA;

  /* Typography */
  --font-display: "Serrif Condensed", Georgia, serif;
  --font-body: "Unica77", "Inter", sans-serif;
  --font-mono: "Unica77 Mono", ui-monospace, monospace;

  --text-h1: 110px;
  --text-h1-leading: 110px;
  --text-h1-tracking: -2.2px;

  --text-h2: 48px;
  --text-h2-leading: 50px;
  --text-h2-tracking: -0.48px;

  --text-body: 18px;
  --text-body-leading: 24px;
  --text-body-tracking: -0.09px;

  /* Shape */
  --radius-pill: 60px;
  --radius-card: 10px;
}
```

## 9. Reuse Checklist

When restyling a fintech/BI/analyst-platform landing page in this direction:

1. Warm off-white base (`#FAF9F5`), not pure white
2. One serif display face for headlines (tight leading, subtle ligatures) + one grotesk sans for everything else
3. Two-line headline pattern: black claim + grey elaboration, same size/font
4. Single saturated accent (orchid purple) reserved for CTAs/links only
5. Secondary amber/orange accent used *only* for small uppercase monospace section numbering
6. Real, unretouched product/spreadsheet screenshots in bordered white cards — not illustrated mockups
7. Decorative pixel-gradient blocks (lavender/aqua) as peripheral ornament, never behind text
8. Testimonials as plain hairline-separated rows, not boxed cards
9. Full-bleed light-orchid band unifying the closing CTA and footer
10. Generous vertical whitespace between sections — let the page breathe

---
*Compiled from direct inspection of equals.com on the date of this analysis. Not affiliated with Equals or getdesign.md. All trademarks belong to their respective owners.*
