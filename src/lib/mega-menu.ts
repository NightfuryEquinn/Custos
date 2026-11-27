import { animate } from "animejs";
import { MOTION, REDUCED_MOTION } from "./motion";

/** Enhance a native dialog with the shared journal menu motion and link behavior. */
export function bindMegaMenu(
  trigger: HTMLButtonElement,
  dialog: HTMLDialogElement,
  navigate: (link: HTMLAnchorElement) => void,
) {
  const panel = dialog.querySelector<HTMLElement>(".mega-menu-panel")!;
  const shade = dialog.querySelector<HTMLElement>(".mega-menu-shade")!;
  const closeButton = dialog.querySelector<HTMLButtonElement>("[data-mega-close]")!;
  const reducedMotion = window.matchMedia(REDUCED_MOTION);
  const listeners = new AbortController();
  const options = { signal: listeners.signal };

  let motion: ReturnType<typeof animate>[] = [];
  let closing = false;

  function stopMotion() {
    motion.forEach((animation) => animation.cancel());
    motion = [];
  }

  function close(afterClose?: () => void) {
    if (!dialog.open || closing) return;
    closing = true;
    stopMotion();

    function finish() {
      dialog.close();
      trigger.setAttribute("aria-expanded", "false");
      closing = false;
      afterClose?.();
    }

    if (reducedMotion.matches) {
      finish();
      return;
    }

    motion = [
      animate(shade, { opacity: 0, duration: MOTION.megaMenu.close, ease: MOTION.exitEase }),
      animate(panel, {
        opacity: 0,
        duration: MOTION.megaMenu.close,
        ease: MOTION.exitEase,
        onComplete: finish,
      }),
    ];
  }

  trigger.addEventListener(
    "click",
    () => {
      if (dialog.open) return;
      stopMotion();
      shade.style.removeProperty("opacity");
      panel.style.removeProperty("opacity");
      panel.style.removeProperty("transform");
      trigger.focus({ preventScroll: true });
      dialog.showModal();
      trigger.setAttribute("aria-expanded", "true");
      closeButton.focus({ preventScroll: true });

      if (reducedMotion.matches) return;

      shade.style.opacity = "0";
      panel.style.transform = "translateY(-8px)";
      motion = [
        animate(shade, { opacity: 1, duration: MOTION.megaMenu.open, ease: MOTION.enterEase }),
        animate(panel, { translateY: 0, duration: MOTION.megaMenu.open, ease: MOTION.enterEase }),
      ];
    },
    options,
  );

  dialog.addEventListener(
    "cancel",
    (event) => {
      event.preventDefault();
      close();
    },
    options,
  );

  shade.addEventListener("click", () => close(), options);
  closeButton.addEventListener("click", () => close(), options);

  dialog.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Tab") return;
      const links = panel.querySelectorAll<HTMLAnchorElement>("a[href]");
      const last = links.item(links.length - 1);
      if (event.shiftKey && document.activeElement === closeButton && last) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        closeButton.focus();
      }
    },
    options,
  );

  dialog.addEventListener(
    "click",
    (event) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        !(event.target instanceof Element)
      ) {
        return;
      }

      const link = event.target.closest<HTMLAnchorElement>("a[href]");
      if (!link || link.target || link.hasAttribute("download")) return;
      event.preventDefault();
      close(() => navigate(link));
    },
    options,
  );

  // Browser history takes precedence over a pending menu selection.
  function onHistory() {
    if (!dialog.open) return;
    stopMotion();
    dialog.close();
    trigger.setAttribute("aria-expanded", "false");
    closing = false;
  }

  window.addEventListener("popstate", onHistory, options);
  window.addEventListener("hashchange", onHistory, options);

  return () => {
    listeners.abort();
    stopMotion();
    if (dialog.open) dialog.close();
    trigger.setAttribute("aria-expanded", "false");
  };
}
