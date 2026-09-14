import { Icon } from "@/frontend/components/ui";
import { useModalMotion } from "@/frontend/lib/animate";
import type { IdentityRecord } from "@/frontend/lib/types";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { unwrapSecrets } from "../lib/device-vault";
import { copySecret } from "../lib/clipboard";
import { sessionSecrets } from "../lib/session-secrets";

type RecoveryRevealProps = {
  identity: IdentityRecord;
  onClose: () => void;
};

export function RecoveryReveal({ identity, onClose }: RecoveryRevealProps) {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [mnemonic, setMnemonic] = useState(
    () => sessionSecrets.get(identity.address)?.mnemonic || identity.mnemonic || "",
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const scrimRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const { requestClose } = useModalMotion(scrimRef, panelRef, { variant: "center" });
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(copiedTimer.current), []);
  const words = mnemonic.split(/\s+/).filter(Boolean);
  const needsPass = !mnemonic && !!identity.vault;

  /** Unlock the vault just long enough to show the phrase. */
  async function revealFromVault() {
    if (!identity.vault) return;
    setError("");
    setBusy(true);
    try {
      const secrets = await unwrapSecrets(passphrase, identity.vault);
      /* Deliberately not cached into sessionSecrets: a one-time "let me see
         my phrase" glance should not silently double as unlocking the
         wallet's signing key for the rest of the tab's life. Worst case if
         a later action needs it, the user is asked for their passphrase
         again through the normal unlock flow. */
      setMnemonic(secrets.mnemonic);
      setShown(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not unlock vault.");
    }
    setBusy(false);
  }

  return createPortal(
    <div
      ref={scrimRef}
      className="modal-scrim center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) requestClose(onClose);
      }}
    >
      <div ref={panelRef} className="modal sm" role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>Recovery Phrase</h3>
          <button
            className="icon-btn"
            type="button"
            onClick={() => requestClose(onClose)}
            aria-label="Close"
            disabled={busy}
          >
            <Icon name="close" size={20} />
          </button>
        </div>
        <div className="modal-body">
          <p className="rec-note2">
            Anyone with these words controls your ledger. Never share them or enter them on another
            site.
          </p>
          {needsPass && !mnemonic ? (
            <>
              <label className="fld-label">
                Device passphrase
                <input
                  className="text-in"
                  type="password"
                  autoComplete="current-password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                />
              </label>
              {error ? <p className="auth-error">{error}</p> : null}
              <button
                className="primary-btn full"
                type="button"
                disabled={busy || !passphrase}
                onClick={() => void revealFromVault()}
              >
                {busy ? "Unlocking…" : "Reveal Phrase"}
              </button>
            </>
          ) : (
            <>
              <div className="phrase-grid">
                {shown
                  ? words.map((w, i) => (
                      <span key={i} className="word">
                        <b>{i + 1}</b>
                        {w}
                      </span>
                    ))
                  : /* Placeholder markup only — the words themselves never enter the DOM
                       (or the accessibility tree) until the user consents to reveal them.
                       A CSS blur alone would still leave the real text readable via
                       devtools/innerText/a screen reader before that consent. */
                    words.map((_, i) => (
                      <span key={i} className="word word--hidden" aria-hidden="true">
                        <b>{i + 1}</b>
                        &bull;&bull;&bull;&bull;&bull;&bull;
                      </span>
                    ))}
              </div>
              <div className="reveal-actions">
                {!shown ? (
                  <button className="ghost-btn full" type="button" onClick={() => setShown(true)}>
                    Tap to Reveal
                  </button>
                ) : (
                  <button
                    className="mini-btn"
                    type="button"
                    onClick={() => {
                      copySecret(mnemonic);
                      setCopied(true);
                      clearTimeout(copiedTimer.current);
                      copiedTimer.current = setTimeout(() => setCopied(false), 1200);
                    }}
                  >
                    <Icon name={copied ? "check" : "copy"} size={14} />{" "}
                    {copied ? "Copied" : "Copy Phrase"}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
