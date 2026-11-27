import { cubicBezier } from "animejs";

export const MOTION = {
  screen: 420,
  stagger: { duration: 360, step: 18, limit: 6 },
  fade: 240,
  dialog: { open: 320, close: 200 },
  picker: { open: 220, close: 160 },
  megaMenu: { open: 340, close: 200 },
  publicEntrance: 440,
  journalHighlight: 420,
  enterEase: cubicBezier(0.22, 0.61, 0.36, 1),
  exitEase: "inOutSine",
} as const;

export const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
