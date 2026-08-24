# design3.md — Letters (letters.app) Visual Design Analysis

> **Independent analysis, not the paid getdesign.md file.** The getdesign.md page at
> `https://getdesign.md/design-md/letters` only exposes a paid preview — the underlying
> DESIGN.md and any purchasable assets were not accessed. This document was produced by
> directly inspecting the live site at `https://letters.app` (visual review + `getComputedStyle`
> extraction via browser automation). It is an original write-up of what an outside observer
> can see on the public site, not a copy of getdesign.md's proprietary content. "Letters" and
> its trademarks belong to their respective owner; this analysis is not affiliated with or
> endorsed by them, and is provided for internal design-reference purposes only.

## 1. Brand Summary

Letters is an AI medical-documentation product for clinicians (letter writing + consultation
transcription). The site's visual language reads as **calm, clinical-but-friendly, and
consumer-grade-polished**: a soft blue "sky" gradient hero, warm off-white/light-gray body
sections, a rounded geometric sans-serif typeface, and heavy use of pill shapes (buttons,
tabs, badges) that echo the softness of a healthcare product without looking sterile.

Framework note: built on **Framer** (confirmed via `framer-*` CSS class prefixes throughout
the DOM).

## 2. Color Palette

| Token | Value | Usage |
|---|---|---|
| Hero gradient top | `rgb(119, 155, 193)` (~`#779BC1`) | Hero background, top of gradient |
| Hero gradient mid | `rgb(154, 191, 218)` (~`#9ABFDA`) at 58% | Hero background, middle stop |
| Hero gradient bottom | `rgb(203, 223, 236)` (~`#CBDFEC`) | Hero background, bottom stop |
| Pricing band gradient | Similar light sky-blue-to-cloud gradient, reused as a full-bleed section background lower on the page | Pricing section backdrop, with cloud illustration imagery |
| Body text (headings) | `rgb(21, 21, 21)` (~`#151515`, near-black) | h1/h2 default color outside the hero |
| Primary button / CTA | `rgb(7, 7, 9)` (near-black) | "Sign up" button, primary CTAs |
| Card background (light) | ~`#f2f2f2`–`#f5f5f5` (light warm gray) | Feature/content cards |
| Card background (white) | `#ffffff` | Testimonial cards, some feature cards |
| Muted gray text | Mid-gray, roughly `#6b6b6b`–`#7a7a7a` | Body copy under headings |
| Accent link blue | Light blue, close to the hero gradient tone | "-16.7%" savings label, some inline links |
| Page background | `#ffffff` | Default section background outside hero/pricing bands |

Overall palette is intentionally narrow: near-black + white + one soft blue family, with gray
as the connective tissue. No secondary/tertiary brand colors were observed — color is used
sparingly and mostly for the hero/pricing "sky" motif.

## 3. Typography

| Element | Font family | Size | Weight | Line height | Letter spacing |
|---|---|---|---|---|---|
| Hero H1 | `"Open Runde", "Open Runde Placeholder", sans-serif` | 80px | 600 | 72px | -3.2px |
| Section H2 | Same (`Open Runde`) | 44px | 600 | — | tight/negative |
| Body paragraph | Same family | 18px | 400 | 25.2px | -0.18px |

**Open Runde** is a rounded, geometric sans-serif (soft terminals on strokes) — it's the
single defining typographic choice of the site, giving headlines a friendly, approachable
character despite the clinical subject matter. Tracking is consistently negative/tight at
large sizes, which is typical of modern SaaS marketing sites (keeps big display type from
feeling loose).

No serif or monospace fonts were observed anywhere on the page — this is a one-typeface
site, leaning entirely on weight and size for hierarchy.

## 4. Layout & Spacing

- **Full-bleed color bands**: hero and pricing sections break out of the standard content
  column and span 100% viewport width with gradient backgrounds; most other sections sit on
  plain white.
- **Generous vertical rhythm**: large gaps (100px+) between major sections; sparse, uncluttered
  composition rather than dense stacking.
- **Center-aligned hero and section headers**, transitioning to **left-aligned, multi-column
  grids** for feature content (2-column and 3-column card grids observed).
- **Card-based content blocks** are the dominant layout primitive — nearly every section below
  the hero is composed of rounded-corner cards (feature cards, pricing cards, testimonial
  cards) rather than plain text blocks.
- **Sticky/fixed top navigation** with a simple horizontal layout: logo left, nav links
  (Use cases, Features, Pricing, Our doctors) center-left, Login + "Sign up" pill button right.

## 5. Components

### Navigation bar
White background, logo + wordmark on the left, dropdown nav items ("Use cases", "Features"
with chevron indicators), plain-text "Pricing" and "Our doctors" links, "Login" as plain text,
and a black pill "Sign up" button as the sole visually-weighted CTA.

### Primary button / CTA
- Background: near-black `rgb(7, 7, 9)`
- `border-radius: 100px` (full pill)
- `padding: 12px 24px`
- White text

### Segmented tab switcher
Pill-shaped container (seen for "Letters"/"Transcribe" toggle and again for "Annual"/"Monthly"
pricing toggle) — inactive tab sits on a light-gray track, active tab gets a white pill
background that appears to slide/highlight, consistent with a Framer-style animated segmented
control.

### Feature / content cards
Recurring pattern across at least 3-4 sections:
- Light warm-gray (`~#f2f2f2`) rounded-corner (large radius, ~24-32px) card containers
- A small white pill-shaped badge combining an icon + label (e.g. "✉️ Letters", "🎙️ Transcribe")
- Bold black subheading (e.g. "Remove small talk – save time")
- Gray descriptive body paragraph
- An embedded mini product-UI mockup (screenshots of the actual app: upload dialogs, waveform
  animations, before/after letter comparisons)
- Occasionally a black "About [X] →" text link with a chevron

### 3-column icon-feature grid
Simpler variant used near the bottom of the features area: white circular icon badge (pencil/
edit, ⌘ command-key, gear icons), bold heading, gray paragraph — no card background, just
white space with generous column gutters.

### Numbered step list ("Supercharge your Practice")
Three steps side by side, each with a large numeral badge; the first/active step is
highlighted with a solid blue card background and white text, while the other steps sit on
plain white with dark text — a common "step 1 is expanded, others are collapsed" pattern.

### Testimonial cards
White rounded cards on a light-gray section background: circular avatar photo above the card,
quote text with selectively **bolded key phrases** (not full sentences — just the impactful
clause), attribution name + role below, and a faint gray cursive "signature" graphic as a
decorative flourish. Carousel-style with prev/next circular arrow controls beneath.

### Pricing section
Full-bleed sky-blue gradient band with decorative cloud illustrations. Contains:
- Large centered "Flexible pricing" H2 in white
- Pill-shaped Annual/Monthly toggle with a "-16.7%" savings callout in blue text
- Three pricing tier cards (Letters Basic / Letters Pro / Letters Enterprise) in white
  rounded cards, offset/staggered vertically for visual interest, each with plan name, a
  small "Save $X" chip badge on the paid tier, large price, one-line description, and a
  checklist of included features

### Footer
Plain white background, 5-column layout: brand mark, "Home page" links, "Navigation" links,
"Use Cases" links, "Socials"/"Legal" links. Bottom row has "All rights reserved" (left),
"Made for doctors in Sydney, Australia" (center), and website-credit attribution (right) in
muted gray text.

## 6. Imagery & Iconography

- Product screenshots embedded directly inside cards (not abstracted illustrations) — shows
  real UI: upload buttons, transcription waveform, "Pause"/"Stop" recording controls, before/
  after document comparisons.
- Small circular/pill icon badges pair an icon with a short text label throughout.
- Decorative floating "envelope"/tooltip cards in the hero showing example medical terms
  (e.g. "Cholecystectomy", "Pneumothorax", "Electrocardiogram") with short definitions —
  a clever way to visually establish domain credibility (medical vocabulary) without dense
  copy.
- Cloud illustration motif reused as the pricing section backdrop, tying back to the hero's
  sky gradient for visual continuity between the two full-bleed color bands.
- Circular headshot photos for testimonials.

## 7. Overall Design Language Takeaways

1. **One typeface, one accent color family** — restraint drives the calm, trustworthy feel
   appropriate for a clinical-adjacent product.
2. **Pill shapes everywhere** — buttons, tabs, badges, chips — a consistent soft-geometry
   motif that ties disparate components together.
3. **Cards as the primary content unit** — almost nothing on the page is "bare" text; content
   is boxed into rounded containers, which reads as organized/modular (fitting a
   documentation-automation product).
4. **Real product screenshots over abstract illustration** — builds credibility by showing the
   actual interface rather than generic marketing graphics.
5. **Selective bold-highlighting inside testimonial quotes** — a lightweight technique to
   guide skimming readers to the value proposition without needing pull-quotes or callout
   boxes.

---
*Compiled via direct visual/CSS inspection of https://letters.app on 2026-08-11. Not
sourced from or affiliated with getdesign.md's paid Letters DESIGN.md product.*
