import { animate, createScope, stagger } from "animejs";

// Content is visible before JS, and remains usable with motion disabled.
const scope = createScope({ root: document.body });
if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  scope.add(() => {
    animate(".folio-hero > *, .folio-sample", {
      opacity: [0, 1],
      translateY: [8, 0],
      duration: 260,
      delay: stagger(35),
      ease: "out(3)",
    });
  });
}
window.addEventListener("pagehide", () => scope.revert(), { once: true });
