import { animate, createScope } from "animejs";

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
    function focusEntry() {
      const midpoint = window.innerHeight / 2;
      let index = 0;
      chapters.forEach((chapter, i) => {
        if (chapter.getBoundingClientRect().top <= midpoint) index = i;
      });
      if (index === active) return;
      active = index;
      entries.forEach((entry, i) => entry.classList.toggle("is-current", i === index));
      animate(entries[index]!, { x: [-4, 0], duration: 300, ease: "out(3)" });
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
