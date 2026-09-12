import type { ViewId } from "@/frontend/lib/types";
import type { StepOptionsButton, Tour } from "shepherd.js";
import { getViewTourSteps, SHELL_TOUR_STEPS } from "./steps";

export type TourKind = ViewId | "shell";

/** How a finished tour ended: run to the end, or dismissed part-way. */
type TourOutcome = "complete" | "cancel";

type RunTourOptions = {
  /** Called once when the tour ends, however it ended. */
  onDone?: (kind: TourKind, outcome: TourOutcome) => void;
};

let activeTour: Tour | null = null;
/* Set while tearing a tour down ourselves (replacing it, or unmounting the
   app), so a programmatic cancel is not recorded as the user answering. */
let silentTeardown = false;

/** Cancel the active tour without reporting it as a user dismissal. */
function teardownActiveTour() {
  if (!activeTour) return;

  silentTeardown = true;
  try {
    if (activeTour.isActive()) activeTour.cancel();
  } finally {
    silentTeardown = false;
    activeTour = null;
  }
}

function waitForElement(selector: string, timeout = 2500): Promise<Element | null> {
  const found = document.querySelector(selector);
  if (found) return Promise.resolve(found);

  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) {
        observer.disconnect();
        resolve(el);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.setTimeout(() => {
      observer.disconnect();
      resolve(document.querySelector(selector));
    }, timeout);
  });
}

function bindButtons(tour: Tour, steps: ReturnType<typeof getViewTourSteps>) {
  return steps.map((step) => ({
    ...step,
    buttons: step.buttons?.map((button): StepOptionsButton => {
      const { kind, ...rest } = button;
      if (kind === "back") return { ...rest, action: () => tour.back() };
      if (kind === "complete") return { ...rest, action: () => tour.complete() };

      return { ...rest, action: () => tour.next() };
    }),
    beforeShowPromise: async () => {
      const selector = typeof step.attachTo?.element === "string" ? step.attachTo.element : null;
      if (selector) await waitForElement(selector);
      if (step.beforeShowPromise) await step.beforeShowPromise();
    },
  }));
}

async function createTour(kind: TourKind, { onDone }: RunTourOptions): Promise<Tour> {
  teardownActiveTour();

  /* Deferred alongside the JS: a static top-level import of this CSS pulled
     it into every load's blocking stylesheet even for users who never open
     a tour — `LedgerApp.tsx` imports this module eagerly for `useLedgerTour`. */
  const [{ default: Shepherd }] = await Promise.all([
    import("shepherd.js"),
    import("shepherd.js/dist/css/shepherd.css"),
  ]);

  const steps = kind === "shell" ? SHELL_TOUR_STEPS : getViewTourSteps(kind);
  const tour = new Shepherd.Tour({
    useModalOverlay: true,
    defaultStepOptions: {
      cancelIcon: { enabled: true },
      scrollTo: { behavior: "smooth", block: "center" },
      classes: "ledger-tour-step",
      modalOverlayOpeningPadding: 8,
      modalOverlayOpeningRadius: 12,
    },
  });

  bindButtons(tour, steps).forEach((step) => tour.addStep(step));

  /* Both endings bank the tour as seen. Dismissing it is an answer, not a
     deferral — treating cancel as "not seen" reopened the tour on every
     single reload for anyone who closed it with the X. */
  let finished = false;
  const finish = (outcome: TourOutcome) => {
    if (finished || silentTeardown) return;
    finished = true;
    activeTour = null;
    onDone?.(kind, outcome);
  };

  tour.on("complete", () => finish("complete"));
  tour.on("cancel", () => finish("cancel"));

  activeTour = tour;

  return tour;
}

/** Start the tour for one view (or the app shell), replacing any active tour. */
export async function runTour(kind: TourKind, options: RunTourOptions = {}) {
  const tour = await createTour(kind, options);
  tour.start();

  return tour;
}

/** Dismiss whatever tour is on screen, without recording an answer. */
export function cancelActiveTour() {
  teardownActiveTour();
}

/** Whether a guided tour is on screen right now. */
export function isTourActive(): boolean {
  return !!activeTour?.isActive();
}
