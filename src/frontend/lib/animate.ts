import { animate, stagger, type JSAnimation } from "animejs";
import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { openConfirm } from "@/frontend/lib/feedback";

const DUR = { fast: 160, base: 240, modal: 220, sheet: 260, scrim: 165, picker: 132 } as const;

const EASE = {
  base: "out(3)",
  modal: "out(3)",
} as const;

type ModalVariant = "sheet" | "center" | "picker";

type EnterOpts = {
  y?: number;
  duration?: number;
  ease?: string;
  disabled?: boolean;
};

type StaggerOpts = {
  y?: number;
  duration?: number;
  staggerMs?: number;
  disabled?: boolean;
};

type FadeOpts = {
  duration?: number;
  disabled?: boolean;
  active?: boolean;
};

type ModalMotionOpts = {
  variant?: ModalVariant;
  disabled?: boolean;
  active?: boolean;
  /**
   * Opt in to shared dismissal: Escape and dismiss() close the topmost
   * managed modal. Pass `false` to lock it (e.g. while saving). Leave it
   * undefined for modals that must not close on Escape.
   */
  onDismiss?: (() => void) | false;
  /** Ask "Discard changes?" before dismissing. */
  dirty?: boolean;
};

/** Managed modals, topmost last; one Escape listener serves them all. */
const dismissStack: { dismiss: () => void }[] = [];

/** Escape closes only the topmost managed modal. */
function onEscape(event: KeyboardEvent) {
  if (event.key !== "Escape" || event.defaultPrevented) return;
  // ponytail: pickers own their Escape and aren't in the stack, so detect them by class.
  if (document.querySelector(".picker-scrim")) return;
  dismissStack.at(-1)?.dismiss();
}

/** Return whether the user prefers reduced motion. */
function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Cancel a running anime.js instance. */
function cancelAnim(anim: JSAnimation | null | undefined) {
  anim?.cancel();
}

/** Set final visible styles on an element. */
function setVisible(el: HTMLElement, transform = "none") {
  el.style.opacity = "1";
  el.style.transform = transform;
}

/** Set hidden styles before an entrance animation. */
function setHidden(el: HTMLElement, opacity: number, translateY: number, scale = 1) {
  el.style.opacity = String(opacity);
  el.style.transform = `translateY(${translateY}px) scale(${scale})`;
}

/** Run enter animation on mount; cleanup cancels on unmount. */
export function useEnter(ref: RefObject<HTMLElement | null>, opts?: EnterOpts) {
  const animRef = useRef<JSAnimation | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || opts?.disabled) return;

    const y = opts?.y ?? 4;
    const duration = opts?.duration ?? DUR.base;
    const ease = opts?.ease ?? EASE.base;

    if (prefersReducedMotion()) {
      setVisible(el);
      return;
    }

    setHidden(el, 0, y);
    animRef.current = animate(el, {
      opacity: 1,
      translateY: 0,
      duration,
      ease,
    });

    return () => cancelAnim(animRef.current);
  }, [ref, opts?.disabled, opts?.duration, opts?.ease, opts?.y]);
}

/** Opacity-only entrance for menus, tips, and live totals. */
export function useFadeIn(ref: RefObject<HTMLElement | null>, opts?: FadeOpts) {
  const animRef = useRef<JSAnimation | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || opts?.disabled || opts?.active === false) return;

    const duration = opts?.duration ?? DUR.fast;

    if (prefersReducedMotion()) {
      setVisible(el);
      return;
    }

    el.style.opacity = "0";
    animRef.current = animate(el, {
      opacity: 1,
      duration,
      ease: EASE.base,
    });

    return () => cancelAnim(animRef.current);
  }, [ref, opts?.active, opts?.disabled, opts?.duration]);
}

/** Cascade child entrances inside a container. */
export function useStagger(
  containerRef: RefObject<HTMLElement | null>,
  childSelector: string,
  opts?: StaggerOpts,
) {
  const animRef = useRef<JSAnimation | null>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || opts?.disabled) return;

    const children = Array.from(container.querySelectorAll<HTMLElement>(childSelector)).slice(0, 6);
    if (!children.length) return;

    const y = opts?.y ?? 6;
    const duration = opts?.duration ?? DUR.base;
    const staggerMs = opts?.staggerMs ?? 30;

    if (prefersReducedMotion()) {
      children.forEach((child) => setVisible(child));
      return;
    }

    children.forEach((child) => setHidden(child, 0, y));
    animRef.current = animate(children, {
      opacity: 1,
      translateY: 0,
      duration,
      ease: EASE.base,
      delay: stagger(staggerMs),
    });

    return () => cancelAnim(animRef.current);
  }, [containerRef, childSelector, opts?.disabled, opts?.duration, opts?.staggerMs, opts?.y]);
}

/** Panel presets matching the old CSS keyframes. */
function panelEnterState(variant: ModalVariant) {
  if (variant === "sheet") return { opacity: 0.6, translateY: 24, scale: 1 };
  if (variant === "picker") return { opacity: 0, translateY: 0, scale: 1 };

  return { opacity: 0, translateY: 4, scale: 1 };
}

/** Panel duration for a modal variant. */
function panelDuration(variant: ModalVariant) {
  if (variant === "sheet") return DUR.sheet;
  if (variant === "picker") return DUR.picker;

  return DUR.scrim;
}

/** Animate modal scrim + panel on mount; expose animated close. */
export function useModalMotion(
  scrimRef: RefObject<HTMLElement | null>,
  panelRef: RefObject<HTMLElement | null>,
  opts?: ModalMotionOpts,
) {
  const enterAnims = useRef<JSAnimation[]>([]);
  const exitAnims = useRef<JSAnimation[]>([]);
  const closingRef = useRef(false);
  const variant = opts?.variant ?? "center";
  const active = opts?.active !== false;
  const managed = opts?.onDismiss !== undefined;
  const latest = useRef({ onDismiss: opts?.onDismiss, dirty: opts?.dirty });
  useEffect(() => {
    latest.current = { onDismiss: opts?.onDismiss, dirty: opts?.dirty };
  });

  useEffect(() => {
    const viewport = window.visualViewport;
    const scrim = scrimRef.current;
    if (!active || !viewport || !scrim) return;
    /** Pin the scrim to the visible area so an on-screen keyboard can't push the modal away. */
    const resize = () => {
      scrim.style.setProperty("--visual-height", `${viewport.height}px`);
      scrim.style.setProperty("--visual-top", `${viewport.offsetTop}px`);
    };

    resize();
    viewport.addEventListener("resize", resize);
    viewport.addEventListener("scroll", resize);

    return () => {
      viewport.removeEventListener("resize", resize);
      viewport.removeEventListener("scroll", resize);
      scrim.style.removeProperty("--visual-height");
      scrim.style.removeProperty("--visual-top");
    };
  }, [active, scrimRef]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!active || !panel || panel.getAttribute("role") !== "dialog") return;
    const previous = document.activeElement as HTMLElement | null;
    panel.setAttribute("aria-modal", "true");
    const frame = requestAnimationFrame(() => {
      // Respect an autoFocus the modal already set; otherwise prefer a field,
      // then the safe footer action (Cancel), never the header close button.
      if (document.activeElement !== panel && panel.contains(document.activeElement)) return;
      (
        panel.querySelector<HTMLElement>(
          '[data-autofocus], input:not([type="hidden"]):not(:disabled), textarea:not(:disabled)',
        ) ??
        panel.querySelector<HTMLElement>(".modal-foot button:not(:disabled)") ??
        panel.querySelector<HTMLElement>("button")
      )?.focus();
    });
    const trap = (event: KeyboardEvent) => {
      if (
        event.key !== "Tab" ||
        [...document.querySelectorAll('[aria-modal="true"]')].at(-1) !== panel
      )
        return;
      const elements = [
        ...panel.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled):not([type="hidden"]), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]',
        ),
      ].filter((el) => el.getClientRects().length > 0);
      const first = elements[0];
      const last = elements.at(-1);
      if (
        event.shiftKey &&
        (document.activeElement === first || !panel.contains(document.activeElement))
      ) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !panel.contains(document.activeElement))
      ) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", trap);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [active, panelRef]);

  /* Cancel any in-flight exit animation on unmount, and also whenever
     `active` flips — a picker/sheet's owner stays mounted across opens, and
     Escape or a view change can set `active` false directly (skipping
     requestClose) while its exit animation from a prior close is still
     running. Left alone, anime.js keeps ticking against the now-detached
     nodes, closingRef never resets, and the stale onDone later re-closes a
     menu the user has since reopened. */
  useEffect(() => {
    return () => {
      exitAnims.current.forEach(cancelAnim);
      exitAnims.current = [];
      closingRef.current = false;
    };
  }, [active]);

  useLayoutEffect(() => {
    const scrim = scrimRef.current;
    const panel = panelRef.current;
    if (!scrim || !panel || opts?.disabled || !active) return;

    enterAnims.current.forEach(cancelAnim);
    enterAnims.current = [];

    if (prefersReducedMotion()) {
      setVisible(scrim);
      setVisible(panel);
      return;
    }

    const enter = panelEnterState(variant);
    scrim.style.opacity = "0";
    setHidden(panel, enter.opacity, enter.translateY, enter.scale);

    enterAnims.current.push(
      animate(scrim, { opacity: 1, duration: DUR.scrim, ease: EASE.base }),
      animate(panel, {
        opacity: 1,
        translateY: 0,
        scale: 1,
        duration: panelDuration(variant),
        ease: variant === "sheet" ? EASE.modal : EASE.base,
      }),
    );

    return () => {
      enterAnims.current.forEach(cancelAnim);
      enterAnims.current = [];
    };
  }, [active, opts?.disabled, panelRef, scrimRef, variant]);

  /** Play exit motion, then call onDone (usually unmount). */
  const requestClose = useCallback(
    (onDone: () => void) => {
      if (closingRef.current) return;

      closingRef.current = true;
      const scrim = scrimRef.current;
      const panel = panelRef.current;

      if (!scrim || !panel || prefersReducedMotion() || opts?.disabled) {
        closingRef.current = false;
        onDone();
        return;
      }

      const enter = panelEnterState(variant);
      let pending = 2;

      /** Finish once both scrim and panel exits complete. */
      const finish = () => {
        pending -= 1;
        if (pending <= 0) {
          closingRef.current = false;
          onDone();
        }
      };

      exitAnims.current = [
        animate(scrim, { opacity: 0, duration: DUR.scrim, ease: EASE.base, onComplete: finish }),
        animate(panel, {
          opacity: enter.opacity,
          translateY: enter.translateY,
          scale: enter.scale,
          duration: panelDuration(variant),
          ease: variant === "sheet" ? EASE.modal : EASE.base,
          onComplete: finish,
        }),
      ];
    },
    [opts?.disabled, panelRef, scrimRef, variant],
  );

  /** Close via the shared path: honours lock and unsaved-changes guard. */
  const dismiss = useCallback(() => {
    const { onDismiss, dirty } = latest.current;
    if (!onDismiss) return;
    if (!dirty) return requestClose(onDismiss);
    openConfirm({
      title: "Discard changes?",
      message: "You have unsaved changes. Closing now will discard them.",
      confirmLabel: "Discard",
      pendingLabel: "Discarding…",
      arm: false,
      onConfirm: () => requestClose(onDismiss),
    });
  }, [requestClose]);

  useEffect(() => {
    if (!active || !managed) return;
    const entry = { dismiss };
    if (dismissStack.push(entry) === 1) window.addEventListener("keydown", onEscape, true);
    return () => {
      dismissStack.splice(dismissStack.indexOf(entry), 1);
      if (!dismissStack.length) window.removeEventListener("keydown", onEscape, true);
    };
  }, [active, managed, dismiss]);

  return { requestClose, dismiss };
}
