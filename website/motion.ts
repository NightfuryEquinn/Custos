import { bindMegaMenu } from "../src/lib/mega-menu";
import { MOTION, REDUCED_MOTION } from "../src/lib/motion";
import { animate, createScope, type JSAnimation } from "animejs";

const entrance = document.querySelectorAll<HTMLElement>("[data-page-entrance]");
const navigation = performance.getEntriesByType("navigation")[0] as
  PerformanceNavigationTiming | undefined;

if (
  entrance.length &&
  !window.matchMedia(REDUCED_MOTION).matches &&
  !window.location.hash &&
  navigation?.type !== "back_forward"
) {
  const animation = animate(entrance, {
    translateY: [4, 0],
    duration: MOTION.publicEntrance,
    ease: MOTION.enterEase,
  });
  // A cached page should be restored with its heading already settled.
  window.addEventListener("pagehide", () => animation.revert(), { once: true });
}

const opening = document.querySelector<HTMLElement>(".folio-opening");
if (opening) {
  const entries = [...opening.querySelectorAll<HTMLElement>(".folio-entry")];
  const chapters = [...opening.querySelectorAll<HTMLElement>("#a-day .folio-story")];
  const scope = createScope({
    root: opening,
    mediaQueries: {
      journal:
        "(min-width: 1024px) and (min-height: 640px) and (prefers-reduced-motion: no-preference)",
    },
  });
  scope.add((self) => {
    if (!self?.matches.journal || !entries.length || entries.length !== chapters.length) return;
    opening.classList.add("has-motion");
    let active = -1;
    let highlight: JSAnimation | undefined;
    function focusEntry() {
      const midpoint = window.innerHeight / 2;
      let index = 0;
      chapters.forEach((chapter, i) => {
        if (chapter.getBoundingClientRect().top <= midpoint) index = i;
      });
      if (index === active) return;
      const changed = active !== -1;
      active = index;
      entries.forEach((entry, i) => entry.classList.toggle("is-current", i === index));
      if (changed) {
        highlight?.revert();
        highlight = animate(entries[index]!, {
          translateX: [-4, 0],
          duration: MOTION.journalHighlight,
          ease: MOTION.enterEase,
        });
      }
    }
    let frame = 0;
    function scheduleFocus() {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        focusEntry();
      });
    }
    window.addEventListener("scroll", scheduleFocus, { passive: true });
    window.addEventListener("resize", scheduleFocus);
    focusEntry();
    return () => {
      cancelAnimationFrame(frame);
      highlight?.revert();
      window.removeEventListener("scroll", scheduleFocus);
      window.removeEventListener("resize", scheduleFocus);
      opening.classList.remove("has-motion");
      entries.forEach((entry) => entry.classList.remove("is-current"));
    };
  });
  window.addEventListener("pagehide", (event) => {
    if (!event.persisted) scope.revert();
  });
}

const menuTrigger = document.querySelector<HTMLButtonElement>("[data-public-menu]");
const menuDialog = document.querySelector<HTMLDialogElement>("#public-menu");
const fallback = document.querySelector<HTMLDetailsElement>(".mega-menu-fallback");
const menuLinks = fallback?.querySelector("nav");
const menuPanel = menuDialog?.querySelector(".mega-menu-panel");

if (menuTrigger && menuDialog?.showModal && fallback && menuLinks && menuPanel) {
  menuPanel.append(menuLinks);
  fallback.hidden = true;
  menuTrigger.hidden = false;

  bindMegaMenu(menuTrigger, menuDialog, (link) => {
    const destination = new URL(link.href);
    const current = new URL(window.location.href);
    // The host can serve the journal at / as well as /index.html.
    const pagePath = (url: URL) => url.pathname.replace(/\/index\.html$/, "/");
    if (destination.origin !== current.origin || pagePath(destination) !== pagePath(current)) {
      window.location.assign(destination.href);
      return;
    }

    if (!destination.hash) {
      if (current.hash) window.location.assign(destination.href);
      return;
    }

    if (destination.hash !== current.hash) window.location.hash = destination.hash;
    const section = document.getElementById(destination.hash.slice(1));
    if (section) {
      section.tabIndex = -1;
      section.focus({ preventScroll: true });
      section.scrollIntoView();
    }
  });
}
