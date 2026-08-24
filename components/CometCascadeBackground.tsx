"use client";

import { useEffect, useRef } from "react";

interface CometCascadeProps {
  /** Trail color near the origin (top). */
  color1?: string;
  /** Trail color at the midpoint of the gradient. */
  color2?: string;
  /** Trail color at the leading edge / outward curve. */
  color3?: string;
  /** Canvas backdrop color. */
  background?: string;
  /** Playback speed multiplier. */
  speed?: number;
  /** Number of simultaneous comet trails. */
  trails?: number;
  className?: string;
}

interface Comet {
  x: number; // current x position (px)
  y: number; // current y position (px)
  vy: number; // vertical speed (px/frame at speed=1)
  bendDir: 1 | -1; // curve outward left (-1) or right (1)
  bendStrength: number; // how sharply it bends near the floor
  history: { x: number; y: number }[]; // trailing points, oldest first
  progress: number; // 0..1 through the fall, used for color/alpha
  seed: number; // phase offset so comets don't move in lockstep
}

const HISTORY_LENGTH = 18;

/**
 * Original re-implementation of the "Comet Cascade" background concept
 * documented in design2.md — NOT the purchased getdesign.md source.
 * Vertical light trails fall from the top and bank outward near the
 * floor, fading from color1 -> color2 -> color3 along each trail.
 *
 * Tuned here for a calm finance/BI hero: lower speed, fewer trails,
 * brand-matched orchid palette (see design2.md section 6 guidance).
 */
export default function CometCascadeBackground({
  color1 = "#8f6fd9", // muted indigo-violet, softened toward brand orchid
  color2 = "#b074ce", // --matsu (brand primary)
  color3 = "#e0a6e8", // soft pink-violet highlight
  background = "#1a1224",
  speed = 0.5,
  trails = 14,
  className,
}: CometCascadeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    let width = 0;
    let height = 0;
    let dpr = 1;
    let comets: Comet[] = [];
    let animationId = 0;
    let destroyed = false;

    function rand(min: number, max: number) {
      return min + Math.random() * (max - min);
    }

    function makeComet(startAbove = false): Comet {
      const startX = rand(width * 0.08, width * 0.92);
      return {
        x: startX,
        y: startAbove ? rand(-height * 0.6, 0) : rand(-height, height * 0.4),
        vy: rand(1.1, 1.9),
        bendDir: Math.random() > 0.5 ? 1 : -1,
        bendStrength: rand(0.35, 0.85),
        history: [],
        progress: 0,
        seed: Math.random() * 1000,
      };
    }

    function resize() {
      const rect = canvas!.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas!.width = Math.max(1, Math.floor(width * dpr));
      canvas!.height = Math.max(1, Math.floor(height * dpr));
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      comets = Array.from({ length: trails }, () => makeComet(true));
    }

    function lerpColor(a: string, b: string, t: number) {
      const ah = parseInt(a.slice(1), 16);
      const bh = parseInt(b.slice(1), 16);
      const ar = (ah >> 16) & 0xff;
      const ag = (ah >> 8) & 0xff;
      const ab = ah & 0xff;
      const br = (bh >> 16) & 0xff;
      const bg = (bh >> 8) & 0xff;
      const bb = bh & 0xff;
      const r = Math.round(ar + (br - ar) * t);
      const g = Math.round(ag + (bg - ag) * t);
      const bch = Math.round(ab + (bb - ab) * t);
      return `rgb(${r}, ${g}, ${bch})`;
    }

    function colorForProgress(p: number) {
      if (p < 0.5) return lerpColor(color1, color2, p / 0.5);
      return lerpColor(color2, color3, (p - 0.5) / 0.5);
    }

    function step(comet: Comet, dt: number) {
      const floorStart = height * 0.62;
      comet.y += comet.vy * dt * 60;
      comet.progress = Math.min(1, Math.max(0, comet.y / height));

      // Bank outward once past the floor threshold, easing into a
      // horizontal drift rather than a hard turn.
      if (comet.y > floorStart) {
        const t = Math.min(1, (comet.y - floorStart) / (height * 0.35));
        const ease = t * t * (3 - 2 * t); // smoothstep
        comet.x += comet.bendDir * comet.bendStrength * ease * dt * 60;
      }

      comet.history.push({ x: comet.x, y: comet.y });
      if (comet.history.length > HISTORY_LENGTH) comet.history.shift();
    }

    function drawComet(comet: Comet) {
      const pts = comet.history;
      if (pts.length < 2) return;
      for (let i = 1; i < pts.length; i++) {
        const t = i / pts.length; // 0 near tail, 1 near head
        const prev = pts[i - 1];
        const cur = pts[i];
        const alpha = Math.pow(t, 1.6) * 0.85;
        const width = Math.max(0.4, t * 1.8);
        ctx!.beginPath();
        ctx!.moveTo(prev.x, prev.y);
        ctx!.lineTo(cur.x, cur.y);
        ctx!.strokeStyle = colorForProgress(comet.progress);
        ctx!.globalAlpha = alpha;
        ctx!.lineWidth = width;
        ctx!.lineCap = "round";
        ctx!.stroke();
      }
      // Bright head glow
      const head = pts[pts.length - 1];
      ctx!.globalAlpha = 0.9;
      ctx!.beginPath();
      ctx!.fillStyle = "#ffffff";
      ctx!.shadowColor = colorForProgress(comet.progress);
      ctx!.shadowBlur = 8;
      ctx!.arc(head.x, head.y, 1.4, 0, Math.PI * 2);
      ctx!.fill();
      ctx!.shadowBlur = 0;
      ctx!.globalAlpha = 1;
    }

    let last = performance.now();
    function frame(now: number) {
      if (destroyed) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      ctx!.fillStyle = background;
      ctx!.fillRect(0, 0, width, height);

      for (const comet of comets) {
        step(comet, dt * speed);
        drawComet(comet);
        if (comet.y - height * 0.35 > height) {
          Object.assign(comet, makeComet(false));
        }
      }

      animationId = requestAnimationFrame(frame);
    }

    resize();
    window.addEventListener("resize", resize);

    if (reduceMotion) {
      // Render a single static-ish frame instead of animating.
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);
      for (const comet of comets) {
        for (let i = 0; i < HISTORY_LENGTH; i++) step(comet, 0.4);
        drawComet(comet);
      }
    } else {
      animationId = requestAnimationFrame(frame);
    }

    return () => {
      destroyed = true;
      cancelAnimationFrame(animationId);
      window.removeEventListener("resize", resize);
    };
  }, [color1, color2, color3, background, speed, trails]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      aria-hidden
      style={{ display: "block", width: "100%", height: "100%" }}
    />
  );
}
