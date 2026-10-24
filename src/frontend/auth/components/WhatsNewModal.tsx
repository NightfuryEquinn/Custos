import { Icon } from "@/frontend/components/ui";
import { useModalMotion } from "@/frontend/lib/animate";
import { RELEASE_NOTES, type ReleaseNotes } from "@/frontend/lib/whats-new";
import { useRef } from "react";
import { createPortal } from "react-dom";

type WhatsNewModalProps = {
  onClose: () => void;
};

/** One version block inside the scrolling changelog. */
function ReleaseSection({ notes }: { notes: ReleaseNotes }) {
  const { version, date, lead, highlights } = notes;

  return (
    <section className="wn-release" aria-labelledby={`whatsnew-v${version}`}>
      <div className="wn-release-head">
        <span className="wn-pill num" id={`whatsnew-v${version}`}>
          v{version}
        </span>
        <p className="wn-date">Released {date}</p>
      </div>

      <p className="dm-lead">{lead}</p>

      <div className="wn-list">
        {highlights.map((item) => (
          <div className="wn-item" key={item.title}>
            <span className="wn-item-icon" aria-hidden>
              <Icon name={item.icon} size={18} />
            </span>
            <div className="wn-item-text">
              <span className="wn-item-title">{item.title}</span>
              <p className="legal-p">{item.body}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Version changelog: one long scroll driven by RELEASE_NOTES (newest first), with Got It fixed at the bottom. */
export function WhatsNewModal({ onClose }: WhatsNewModalProps) {
  const scrimRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const { dismiss } = useModalMotion(scrimRef, panelRef, { variant: "center", onDismiss: onClose });

  return createPortal(
    <div
      ref={scrimRef}
      className="modal-scrim center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) dismiss();
      }}
    >
      <div
        ref={panelRef}
        className="modal sm wn-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="whatsnew-title"
      >
        <div className="modal-head">
          <h3 id="whatsnew-title">What&apos;s New</h3>
          <button className="icon-btn" type="button" onClick={() => dismiss()} aria-label="Close">
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="modal-body modal-scroll">
          {RELEASE_NOTES.map((notes) => (
            <ReleaseSection key={notes.version} notes={notes} />
          ))}
        </div>
        <div className="modal-foot">
          <button className="primary-btn full" type="button" onClick={() => dismiss()}>
            Got It
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
