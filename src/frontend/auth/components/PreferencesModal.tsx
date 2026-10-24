import { Icon } from "@/frontend/components/ui";
import { useModalMotion } from "@/frontend/lib/animate";
import {
  disablePush,
  enablePush,
  PUSH_FAILURE_NOTE,
  pushStatus,
  type PushStatus,
} from "@/frontend/lib/push/subscribe";
import type { Account } from "@/frontend/lib/types";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  biometricEnrolled,
  biometricSupported,
  disableBiometric,
  enrollBiometric,
} from "../lib/biometric";
import { keepUnlockedEnabled, setKeepUnlocked } from "@/frontend/lib/crypto/unlock-persist";
import { unwrapSecrets } from "../lib/device-vault";
import { identityStorage } from "../lib/identity-storage";
import { codenameFor } from "../lib/codename";

/*
 * Preferences modal
 * ──────────────────
 * Per-device settings:
 *   1. Push notifications — Web Push reminders for this device
 *   2. Stay unlocked      — keep the unlock keys on this device for 12 hours
 *   3. Face ID            — biometric unlock instead of the device passphrase
 */

type PreferencesModalProps = {
  account: Account;
  onClose: () => void;
};

export function PreferencesModal({ account, onClose }: PreferencesModalProps) {
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const idn = identityStorage.find(account.address);
  const hasVault = !!idn?.vault;
  const [bioSupported, setBioSupported] = useState(false);
  const [bioOn, setBioOn] = useState(() => biometricEnrolled(account.address));
  const [bioBusy, setBioBusy] = useState(false);
  const [bioError, setBioError] = useState("");
  const [bioConfirmPass, setBioConfirmPass] = useState("");
  const [bioConfirming, setBioConfirming] = useState(false);

  useEffect(() => {
    pushStatus()
      .then(setStatus)
      .catch(() => setStatus({ supported: false, permission: "default", subscribed: false }));
    void biometricSupported().then(setBioSupported);
  }, []);

  const toggle = async () => {
    if (!status) return;
    setBusy(true);
    setNote("");
    try {
      if (status.subscribed) {
        await disablePush();
      } else {
        const result = await enablePush();
        if (!result.ok) setNote(PUSH_FAILURE_NOTE[result.reason] ?? PUSH_FAILURE_NOTE.failed!);
      }
      setStatus(await pushStatus());
    } catch {
      setNote(PUSH_FAILURE_NOTE.failed!);
    } finally {
      setBusy(false);
    }
  };

  const startBioEnroll = () => {
    setBioError("");
    setBioConfirmPass("");
    setBioConfirming(true);
  };

  const confirmBioEnroll = async () => {
    if (!idn?.vault) return;
    setBioBusy(true);
    setBioError("");
    try {
      await unwrapSecrets(bioConfirmPass, idn.vault);
    } catch {
      setBioError("Wrong passphrase.");
      setBioBusy(false);
      return;
    }
    try {
      const ok = await enrollBiometric(
        account.address,
        idn.codename || codenameFor(account.address),
        bioConfirmPass,
      );
      if (ok) {
        setBioOn(true);
        setBioConfirming(false);
        setBioConfirmPass("");
      } else {
        setBioError("Face ID isn't available on this device.");
      }
    } catch {
      setBioError("Could not set up Face ID.");
    } finally {
      setBioBusy(false);
    }
  };

  const disableBio = () => {
    disableBiometric(account.address);
    setBioOn(false);
  };

  const [keepOn, setKeepOn] = useState(() => keepUnlockedEnabled(account.address));
  const toggleKeepUnlocked = () => {
    const next = !keepOn;
    setKeepOn(next);
    void setKeepUnlocked(account.address, next);
  };

  const on = status?.subscribed === true;
  const unsupported = status !== null && !status.supported;
  const modalBusy = busy || bioBusy;
  const scrimRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const { dismiss } = useModalMotion(scrimRef, panelRef, {
    variant: "center",
    onDismiss: modalBusy ? false : onClose,
  });

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
        className="modal sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="preferences-title"
      >
        <div className="modal-head">
          <h3 id="preferences-title">Preferences</h3>
          <button
            className="icon-btn"
            type="button"
            onClick={dismiss}
            aria-label="Close"
            disabled={modalBusy}
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="modal-body modal-scroll">
          <div className="dm-sec">
            <div className="consent-card">
              <div className="consent-top">
                <div>
                  <div className="consent-title">Notifications on this device</div>
                  <p className="consent-desc">
                    Get event reminders and Nudges while Custos is closed. Checked every 15 minutes;
                    this setting affects only this device.
                  </p>
                  <p className="consent-desc">
                    Notifications may show event names, times, budget holds and comments, or a
                    Nudge's title, goal and description. Email reminders are managed separately.
                  </p>
                </div>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={busy || status === null || unsupported}
                    onChange={toggle}
                  />
                  <span className="toggle-ui" />
                </label>
              </div>
              <div className={`consent-status ${on ? "cs-on" : "cs-off"}`}>
                <span className="cs-dot" />
                {status === null
                  ? "Checking this device…"
                  : unsupported
                    ? "Not available in this browser"
                    : on
                      ? "Enabled — reminders will notify this device"
                      : "Disabled — no push notifications on this device"}
              </div>
            </div>
            {note ? <p className="dm-note">{note}</p> : null}
            {unsupported ? <p className="dm-note">{PUSH_FAILURE_NOTE.unsupported}</p> : null}
          </div>

          <div className="dm-div" />
          <div className="dm-sec">
            <div className="consent-card">
              <div className="consent-top">
                <div>
                  <div className="consent-title">Stay unlocked on this device</div>
                  <p className="consent-desc">
                    Skip the passphrase when you reload within 12 hours. This stores your unlock
                    keys in this browser's storage until they expire; anyone who copies this browser
                    profile in that time could read your data. Leave it off on shared computers.
                    Signing out removes the keys.
                  </p>
                </div>
                <label className="switch">
                  <input type="checkbox" checked={keepOn} onChange={toggleKeepUnlocked} />
                  <span className="toggle-ui" />
                </label>
              </div>
              <div className={`consent-status ${keepOn ? "cs-on" : "cs-off"}`}>
                <span className="cs-dot" />
                {keepOn
                  ? "Enabled — reloads stay unlocked for up to 12 hours"
                  : "Disabled — you unlock each time you open Custos"}
              </div>
            </div>
          </div>

          {hasVault ? (
            <>
              <div className="dm-div" />
              <div className="dm-sec">
                <div className="consent-card">
                  <div className="consent-top">
                    <div>
                      <div className="consent-title">Unlock With Face ID</div>
                      <p className="consent-desc">
                        The prompt appears when you open Custos. Your passphrase is encrypted with a
                        key tied to your biometric check and stays on this device. Turning this off
                        removes it from Custos; remove the saved entry from your device settings
                        separately.
                      </p>
                    </div>
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={bioOn}
                        disabled={bioBusy || !bioSupported}
                        onChange={() => (bioOn ? disableBio() : startBioEnroll())}
                      />
                      <span className="toggle-ui" />
                    </label>
                  </div>
                  <div className={`consent-status ${bioOn ? "cs-on" : "cs-off"}`}>
                    <span className="cs-dot" />
                    {!bioSupported
                      ? "Not available on this device"
                      : bioOn
                        ? "Enabled — Face ID can unlock this device"
                        : "Disabled — use your device passphrase to unlock"}
                  </div>
                </div>
                {bioConfirming ? (
                  <label className="fld u-gap-top">
                    <p className="dm-subhead">Confirm your device passphrase</p>
                    <div className="settings-inline-row">
                      <input
                        className="text-in"
                        type="password"
                        autoComplete="current-password"
                        value={bioConfirmPass}
                        onChange={(e) => setBioConfirmPass(e.target.value)}
                        disabled={bioBusy}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void confirmBioEnroll();
                        }}
                      />
                      <button
                        className="ghost-btn"
                        type="button"
                        disabled={bioBusy || !bioConfirmPass}
                        onClick={() => void confirmBioEnroll()}
                      >
                        {bioBusy ? "Checking…" : "Confirm"}
                      </button>
                    </div>
                  </label>
                ) : null}
                {bioError ? <p className="dm-note">{bioError}</p> : null}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
