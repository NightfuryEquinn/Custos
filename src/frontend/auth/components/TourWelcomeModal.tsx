import { NAV_ITEM_BY_ID } from "@/frontend/lib/nav";
import type { ViewId } from "@/lib/views";
import { useModalMotion } from "@/frontend/lib/animate";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";

type TourWelcomeModalProps = {
  /** Take the guided walkthrough: shell tour now, view tours as they open. */
  onGuided: () => Promise<unknown>;
  /** Skip every automatic tour; the help button and menu entry still work. */
  onExplore: () => Promise<unknown>;
  /** Save a non-default start page; new accounts already open on Home. */
  onStartView: (id: ViewId) => Promise<unknown>;
  /** Called after the exit animation, so the parent can unmount the modal. */
  onClosed: () => void;
};

/** Pages worth offering at first launch; the rest are one Navigation setting away. */
const START_CHOICES: ViewId[] = ["overview", "daily", "schedule", "transactions"];

/**
 * First-run prompt: guided tour or explore alone. Shown once per user — the
 * answer is stored on their profile, so it follows them to every device.
 */
export function TourWelcomeModal({
  onGuided,
  onExplore,
  onStartView,
  onClosed,
}: TourWelcomeModalProps) {
  const scrimRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const { requestClose } = useModalMotion(scrimRef, panelRef, { variant: "center" });
  const [choosing, setChoosing] = useState<"guided" | "explore" | null>(null);
  const [start, setStart] = useState<ViewId>("overview");
  /* Saved when the person picks one, Home included: an older account would otherwise keep
     opening on its first favorite on phones even after choosing Home here. */
  const [startTouched, setStartTouched] = useState(false);

  /** Persist the choice, then close. Guards against a double tap. */
  const choose = async (choice: "guided" | "explore", save: () => Promise<unknown>) => {
    if (choosing) return;

    setChoosing(choice);
    try {
      await save();
      if (startTouched) await onStartView(start);
      requestClose(onClosed);
    } catch {
      /* Leave the modal open so the choice can be made again. */
      setChoosing(null);
    }
  };

  return createPortal(
    /* Deliberately not closable by scrim or Escape: this is asked once, and a
       stray click should not silently answer it. */
    <div ref={scrimRef} className="modal-scrim center">
      <div
        ref={panelRef}
        className="modal sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-welcome-title"
      >
        <div className="modal-head">
          <h3 id="tour-welcome-title">Welcome to Custos</h3>
        </div>

        <div className="modal-body">
          <p className="dm-lead">Take a short tour, or explore on your own.</p>

          <span className="fld-label" id="tour-start-label">
            Open Custos on
          </span>
          <div className="sub-row" role="radiogroup" aria-labelledby="tour-start-label">
            {START_CHOICES.map((id) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={start === id}
                className={"sub-chip" + (start === id ? " active" : "")}
                disabled={!!choosing}
                onClick={() => {
                  setStart(id);
                  setStartTouched(true);
                }}
              >
                {NAV_ITEM_BY_ID.get(id)![1]}
              </button>
            ))}
          </div>
          <p className="fld-hint">The ? beside any page title replays that page's tour.</p>
        </div>

        <div className="modal-foot modal-foot-stacked">
          <div className="mf-row mf-row-full tour-welcome-actions">
            <button
              className="ghost-btn full"
              type="button"
              disabled={!!choosing}
              onClick={() => void choose("explore", onExplore)}
            >
              <span className="btn-label">
                {choosing === "explore" ? "Saving…" : "I'll explore"}
              </span>
            </button>
            <button
              className="primary-btn full"
              type="button"
              disabled={!!choosing}
              onClick={() => void choose("guided", onGuided)}
            >
              <span className="btn-label">
                {choosing === "guided" ? "Saving…" : "Show me around"}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
