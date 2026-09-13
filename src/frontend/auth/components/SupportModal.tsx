import { Icon } from "@/frontend/components/ui";
import { api } from "@/frontend/lib/api";
import { useModalMotion } from "@/frontend/lib/animate";
import { SUPPORT_LINKS } from "@/lib/support-links";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type SupportModalProps = {
  onClose: () => void;
};

const TIP_LINKS = SUPPORT_LINKS.filter((l) => l.kind === "tip");
const LIFETIME_LINKS = SUPPORT_LINKS.filter((l) => l.kind === "lifetime");

/**
 * Optional funding: tips and a one-time Lifetime Supporter unlock. Nothing
 * here is a paywall — the core ledger, encryption, exports, and backups stay
 * free and ungated either way.
 */
export function SupportModal({ onClose }: SupportModalProps) {
  const [supporterSince, setSupporterSince] = useState<string | undefined>(undefined);
  const scrimRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const { requestClose } = useModalMotion(scrimRef, panelRef, { variant: "center" });

  useEffect(() => {
    api.users
      .me()
      .then(({ user }) => setSupporterSince(user.supporterSince))
      .catch(() => {});
  }, []);

  return createPortal(
    <div
      ref={scrimRef}
      className="modal-scrim center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) requestClose(onClose);
      }}
    >
      <div ref={panelRef} className="modal sm" role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>Support Custos</h3>
          <button
            className="icon-btn"
            type="button"
            onClick={() => requestClose(onClose)}
            aria-label="Close"
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="modal-body modal-scroll">
          <p className="dm-lead">
            Custos is free on the official host with full features, and always will be. Tips and the
            one-time Lifetime unlock below are optional and keep the lights on — they never gate
            anything in the ledger itself.
          </p>

          {supporterSince ? (
            <div className="consent-card">
              <div className="consent-status cs-on">
                <span className="cs-dot" />
                Lifetime Supporter since {new Date(supporterSince).toLocaleDateString()}
              </div>
            </div>
          ) : null}

          <div className="dm-sec">
            <span className="fld-label">Send a tip</span>
            <p className="dm-lead">A one-off or recurring tip, whatever feels right.</p>
            <div className="wn-list">
              {TIP_LINKS.map((link) => (
                <a
                  key={link.url}
                  className="am-item"
                  href={link.url}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  <Icon name="sparkle" size={16} /> {link.label}
                </a>
              ))}
            </div>
          </div>

          <div className="dm-div" />

          <div className="dm-sec">
            <span className="fld-label">Lifetime Supporter</span>
            <p className="dm-lead">
              A one-time unlock: a badge next to your name and a choice of accent colors. Checkout
              asks for the wallet address you sign in with — the perk shows up within about 24
              hours.
            </p>
            <div className="wn-list">
              {LIFETIME_LINKS.map((link) => (
                <a
                  key={link.url}
                  className="am-item"
                  href={link.url}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  <Icon name="piggy" size={16} /> {link.label}
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
