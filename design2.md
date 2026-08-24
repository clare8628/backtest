# DESIGN2.md — "Comet Cascade" Animated Background (getdesign.md)

> Independent analysis based on the live public preview at getdesign.md/backgrounds?fx=comet-cascade. The underlying component source (`app/components/backgrounds/effects/comet-cascade.tsx`) is **not publicly available** — it ships only after a $49 one-time purchase bundled with the "Animated Backgrounds" pack (36 effects) + a free "Product Demo Video Template". Everything below is derived from the public interactive demo, its live-editable parameter panel, and direct visual inspection — not from the purchased source file.

## 1. What It Is

**Comet Cascade** is effect `/03` of 36 in getdesign.md's "Animated Backgrounds" product — a paid bundle of pre-built canvas/WebGL background components meant to be dropped behind hero sections, footers, CTA bands, or dark product-page sections. It is explicitly designed to be installed and then **re-tuned via natural-language prompts to an AI coding agent** (colors, speed, mood) rather than hand-edited.

- **Rendering technique:** `canvas-2d` (stated directly on the product page; not WebGL/shader-based like some of the other 35 effects in the pack)
- **Category:** Hero band / footer / dark section decorative motion
- **Distribution:** Real component file inside a purchasable starter-kit-style bundle, plus an "agent skill" file so an AI coding tool can install/reposition/retune it autonomously
- **Price:** $49 one-time (bundle price also includes a free video template product)

## 2. Visual Description

Multiple thin vertical light trails ("comets") fall from the top edge of the container, positioned in a loose vertical fan across the width of the section. As each trail approaches the bottom third of the frame, it curves outward — left-falling trails bank left, right-falling trails bank right — flattening out horizontally near the floor, evoking (per the product's own copy) **"a fountain hitting glass."**

Each trail has:
- A **bright, near-white/light core "head"** at the leading (falling) end
- A **fading gradient tail** trailing back up toward the origin point, losing both brightness and opacity as it recedes
- A **color shift along the curve**: cooler blue-violet near the top/origin, warming through purple to magenta/pink as the trail curves outward and reaches the bottom
- Trails vary slightly in length, curve radius, and horizontal landing position, giving the fan an organic, non-mechanical rhythm rather than perfect symmetry

The background is a near-black charcoal (`#0F1013`), making the glowing trails read as light sources — consistent with the "hero sections need motion and depth without a heavy video file" positioning in the product copy.

## 3. Confirmed Parameters (read directly from the live control panel)

| Prop | Default value | Type / role |
|---|---|---|
| `color1` | `#5B4BD8` | Indigo/blue-violet — used near the trail origin (top) |
| `color2` | `#9B3FD4` | Mid-purple — transitional midpoint of the gradient |
| `color3` | `#E04FAE` | Magenta/pink — used at the trail's leading edge / outward curve |
| `background` | `#0F1013` | Near-black canvas backdrop |
| `speed` | `1.0` | Float, animation playback rate multiplier |
| `trails` | `36.0` | Float/int, number of simultaneous comet trails rendered |

This is a deliberately **small prop surface** — the product page states this explicitly ("a small prop surface") as a selling point: the whole visual identity of the effect is controllable through 6 values, which is exactly what makes it "AI-promptable" (an agent can map a request like "calmer and slower" to `speed: 0.4` without touching render logic).

## 4. Inferred Technical Approach

Since only the parameter surface and rendered output are public, the following is a **reasonable reconstruction**, not verified against the actual source:

1. **Particle/trail model**: each of the `trails` count is likely a simple state object — `{ x, y, vx, vy, curveProgress, seed }` — updated per animation frame on a `<canvas>` 2D context (not SVG/DOM, given the "canvas-2d" tag and the smoothness of overlapping glow at high trail counts).
2. **Falling + curving motion**: y-velocity dominates early (near-vertical fall), then a horizontal component ramps in as the particle's y-position crosses a threshold near the bottom of the frame — likely an eased/interpolated bend (e.g. `lerp` toward a target curve or a sine/cubic-bezier-driven horizontal offset) rather than physical fluid simulation.
3. **Trail rendering**: each comet is almost certainly drawn as a short history buffer of recent positions (a ring buffer of N previous points) connected with a stroked path whose `globalAlpha` and `lineWidth` taper from the head to the tail — the classic canvas "comet trail" technique — rather than per-frame full recompute of a spline.
4. **Color gradient along the trail**: a `CanvasGradient` (likely `createLinearGradient` along the trail's local path, or per-segment color lerp between `color1` → `color2` → `color3` based on the particle's progress/position) applied per stroke segment.
5. **Glow**: the bloom-like look around each bright head is likely achieved with either `shadowBlur`/`shadowColor` canvas properties on the head point, or an additive-composite (`globalCompositeOperation = "lighter"`) overlay pass — both are common lightweight canvas glow techniques and match the soft, non-pixelated bloom visible in the screenshots.
6. **Speed prop**: almost certainly a direct multiplier on the per-frame delta-time or velocity terms, not a separate animation curve.

## 5. Reuse Guidance — Building an Equivalent Effect Yourself

If the goal is a similar hero/footer background **without** purchasing the bundle, here is a self-contained implementation plan using the same parameter surface:

```tsx
// Conceptual sketch — NOT the purchased source, an original re-implementation plan.
type CometCascadeProps = {
  color1?: string;   // default "#5B4BD8"
  color2?: string;   // default "#9B3FD4"
  color3?: string;   // default "#E04FAE"
  background?: string; // default "#0F1013"
  speed?: number;    // default 1.0
  trails?: number;   // default 36
};
```

**Implementation steps:**
1. Mount a full-bleed `<canvas>` absolutely positioned behind the target section (`position: absolute; inset: 0; z-index: 0;` with content at `z-index: 1`), matching the "drop it behind a section" mounting pattern the product describes.
2. On resize, set canvas width/height to the container's bounding box × `devicePixelRatio` for crisp trails.
3. Initialize `trails` comet objects with randomized: horizontal start position, fall speed, curve-bend direction (left/right), and a phase offset so they don't all animate in lockstep.
4. Each frame: advance each comet's position, push the new point into its trail history buffer (cap at ~15–25 points), then draw the buffer as a stroked path with per-segment alpha/width tapering and a 3-stop color gradient (`color1 → color2 → color3`) along the stroke.
5. Reset a comet to the top once it exits the bottom of the canvas or its trail fully fades, so the effect loops indefinitely without a hard restart.
6. Expose `speed` as a multiplier on the per-frame position delta, and `trails` as the pool size initialized on mount.
7. Respect `prefers-reduced-motion` by freezing or drastically slowing the animation — the source product doesn't advertise this, but it's a reasonable accessibility addition for any hero background effect.

## 6. Where This Fits in a Design System

If pairing with a hero section (e.g. the Equals-style `design.md` analyzed earlier in this project), Comet Cascade's default indigo→purple→magenta palette would need remapping to the host brand's accent — the product's own suggested AI prompt is literally *"Put Comet Cascade behind the landing hero in our brand colors,"* confirming the palette is meant to be swapped per-project rather than kept as-is.

For a finance/BI-style calm brand (like the Equals analysis), a toned-down variant would likely set:
- `speed` lower (~0.4–0.6) for a "quiet motion" footer/CTA band per the product's own "Footers & CTA bands" use case
- A 2-stop instead of 3-stop gradient, or desaturated hues, to avoid clashing with an editorial/trustworthy tone
- Reduced `trails` count (e.g. 12–18) for subtlety behind text-heavy sections

## 7. What This Document Does *Not* Include

To be clear about scope and avoid misrepresenting paid IP as freely obtained:

- ❌ The actual `comet-cascade.tsx` source code (never fetched — it is behind payment)
- ❌ The exact easing functions, curve math, or glow implementation (Section 4 is a plausible reconstruction, not verified)
- ❌ The "agent skill" file contents that ship with the bundle for AI-tool auto-installation
- ✅ All color values, prop names/defaults, pricing, and visual behavior above were read directly from the public interactive demo

---
*Compiled from direct inspection of the public getdesign.md demo page. Not affiliated with getdesign.md/VoltAgent. All product names and trademarks belong to their respective owners. If you want to use the actual effect, purchase it at https://getdesign.md/backgrounds.*
