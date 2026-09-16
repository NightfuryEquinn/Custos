import { Icon } from "@/frontend/components/ui";
import { api } from "@/frontend/lib/api";
import { useModalMotion } from "@/frontend/lib/animate";
import { useTheme } from "@/frontend/lib/hooks/useTheme";
import type { AccentName } from "@/frontend/lib/theme";
import { ACCENTS, ACCENT_NAMES } from "@/lib/accents";
import { SUPPORT_LINKS } from "@/lib/support-links";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";

type SupportModalProps = {
  onClose: () => void;
};

const TIP_LINKS = SUPPORT_LINKS.filter((l) => l.kind === "tip");

/**
 * Optional funding (tips) plus the accent color picker. Nothing here is a
 * paywall — the core ledger, encryption, exports, and backups stay free and
 * ungated, and accent colors are free for everyone.
 */
export function SupportModal({ onClose }: SupportModalProps) {
  const [accentBusy, setAccentBusy] = useState(false);
  const { accentName, setAccentName, dark } = useTheme();
  const scrimRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const { requestClose } = useModalMotion(scrimRef, panelRef, { variant: "center" });

  /* Repaint immediately, then persist so it follows the account across
     devices; on failure, fall back to whatever the server still has. */
  const pickAccent = async (name: AccentName) => {
    if (accentBusy || name === accentName) return;
    const previous = accentName;
    setAccentName(name);
    setAccentBusy(true);
    try {
      await api.profile.update({ accent: name });
    } catch {
      setAccentName(previous);
    } finally {
      setAccentBusy(false);
    }
  };

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
            Custos is free on the official host with full features, and always will be. Tips below
            are optional and keep the lights on — they never gate anything in the ledger itself.
          </p>

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
            <span className="fld-label">Accent color</span>
            <p className="dm-lead">Pick the accent color used across the app.</p>
            <div className="accent-swatches" role="radiogroup" aria-label="Accent color">
              {ACCENT_NAMES.map((name) => (
                <button
                  key={name}
                  type="button"
                  className={`accent-swatch${name === accentName ? " is-selected" : ""}`}
                  style={{ background: ACCENTS[name][dark ? "dark" : "light"] }}
                  disabled={accentBusy}
                  aria-pressed={name === accentName}
                  aria-label={name}
                  onClick={() => void pickAccent(name)}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
