import { useEnter } from "@/frontend/lib/animate";
import { Brand } from "@/frontend/components/Brand";
import { Icon } from "@/frontend/components/ui";
import { identityStorage } from "@/frontend/auth/lib/identity-storage";
import { unwrapSecrets, wrapSecrets, isValidPassphrase } from "@/frontend/auth/lib/device-vault";
import {
  biometricEnrolled,
  biometricSupported,
  enrollBiometric,
  markAskedToEnrollBiometric,
  unlockWithBiometric,
  wasAskedToEnrollBiometric,
} from "@/frontend/auth/lib/biometric";
import { codenameFor } from "@/frontend/auth/lib/codename";
import { sessionSecrets } from "@/frontend/auth/lib/session-secrets";
import { walletClient } from "@/frontend/auth/lib/wallet";
import { unlockLedgerKey } from "@/frontend/lib/crypto/unlock";
import type { Account, IdentityRecord } from "@/frontend/lib/types";
import { useEffect, useRef, useState } from "react";

type UnlockScreenProps = {
  account: Account;
  onUnlocked: () => void;
  onSignOut: () => void;
  signingOut?: boolean;
};

/** Resolve signing material for unlock (session, vault, or one-shot legacy migration). */
async function materializeIdentity(
  idn: IdentityRecord,
  passphrase: string,
): Promise<IdentityRecord> {
  const session = sessionSecrets.get(idn.address);
  if (session) {
    return { ...idn, mnemonic: session.mnemonic, privateKey: session.privateKey };
  }

  if (idn.vault) {
    if (!passphrase) throw new Error("Enter your device passphrase.");
    const secrets = await unwrapSecrets(passphrase, idn.vault);
    sessionSecrets.set(idn.address, secrets);

    return { ...idn, ...secrets };
  }

  /* Legacy plaintext in memory only — require passphrase to vault before unlock. */
  if (idn.privateKey && idn.mnemonic) {
    if (!passphrase) {
      throw new Error("Set a device passphrase to encrypt your local key.");
    }
    if (!isValidPassphrase(passphrase)) {
      throw new Error("Passphrase must be at least 8 characters.");
    }
    const vault = await wrapSecrets(passphrase, {
      mnemonic: idn.mnemonic,
      privateKey: idn.privateKey,
    });
    identityStorage.upsert({
      address: idn.address,
      codename: idn.codename,
      vault,
      injected: false,
      lastSeen: Date.now(),
    });
    sessionSecrets.set(idn.address, {
      mnemonic: idn.mnemonic,
      privateKey: idn.privateKey,
    });

    return { ...idn, vault, mnemonic: idn.mnemonic, privateKey: idn.privateKey };
  }

  return idn;
}

export function UnlockScreen({
  account,
  onUnlocked,
  onSignOut,
  signingOut = false,
}: UnlockScreenProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [canBiometricUnlock, setCanBiometricUnlock] = useState(false);
  const [showOffer, setShowOffer] = useState(false);
  const [offerBusy, setOfferBusy] = useState(false);
  const [offerError, setOfferError] = useState("");
  const idn = identityStorage.find(account.address);
  const idnAddress = idn?.address;
  const idnInjected = idn?.injected;
  const session = idn ? sessionSecrets.get(idn.address) : undefined;
  const needsWalletSign = !!idn?.injected || (!session && !idn?.privateKey && !idn?.vault);
  const needsPassphrase = !!idn && !idn.injected && !session && (!!idn.vault || !!idn.privateKey);
  const migrating = !!idn && !idn.injected && !idn.vault && !!idn.privateKey && !!idn.mnemonic;
  const cardRef = useRef<HTMLDivElement>(null);
  useEnter(cardRef);

  useEffect(() => {
    if (!idnAddress || idnInjected) {
      setCanBiometricUnlock(false);
      return;
    }
    let live = true;
    void biometricSupported().then((supported) => {
      if (live) setCanBiometricUnlock(supported && biometricEnrolled(idnAddress));
    });
    return () => {
      live = false;
    };
  }, [idnAddress, idnInjected]);

  async function unlock(passphraseOverride?: string, viaBiometric = false) {
    if (!idn) {
      setError("No local identity found. Sign in again to unlock your ledger.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      const passValue = passphraseOverride ?? passphrase;
      const ready = await materializeIdentity(idn, passValue);
      await unlockLedgerKey(ready);
      if (
        !viaBiometric &&
        needsPassphrase &&
        (await biometricSupported()) &&
        !wasAskedToEnrollBiometric(idn.address)
      ) {
        setBusy(false);
        setShowOffer(true);
        return;
      }
      onUnlocked();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not unlock encryption key.");
    }
    setBusy(false);
  }

  async function biometricUnlock(silent = false) {
    if (!idn) return;
    setError("");
    if (!silent) setBusy(true);
    let pass: string;
    try {
      pass = await unlockWithBiometric(idn.address);
    } catch (e) {
      if (!silent) setError(e instanceof Error ? e.message : "Could not unlock with Face ID.");
      setBusy(false);
      return;
    }
    await unlock(pass, true);
  }

  /* Prompt as soon as the screen is ready. Browsers that demand a user gesture
     (WebKit) reject instantly — the button below stays as the fallback. */
  const autoTried = useRef(false);
  useEffect(() => {
    if (!canBiometricUnlock || autoTried.current) return;
    autoTried.current = true;
    void biometricUnlock(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canBiometricUnlock]);

  async function acceptBiometricOffer() {
    if (!idn) return;
    setOfferBusy(true);
    setOfferError("");
    try {
      const ok = await enrollBiometric(
        idn.address,
        idn.codename || codenameFor(idn.address),
        passphrase,
      );
      if (!ok) setOfferError("Face ID isn't available on this device.");
    } catch {
      setOfferError("Could not set up Face ID.");
    }
    markAskedToEnrollBiometric(idn.address);
    setOfferBusy(false);
    onUnlocked();
  }

  function declineBiometricOffer() {
    if (idn) markAskedToEnrollBiometric(idn.address);
    onUnlocked();
  }

  if (showOffer) {
    return (
      <div className="auth-wrap">
        <div ref={cardRef} className="auth-card">
          <Brand />
          <h1>Use Face ID on this Device?</h1>
          <p className="auth-lead">
            Next time, Custos will ask for Face ID or Touch ID on its own — no need to type your
            passphrase. Your passphrase is encrypted with your biometric key and never leaves this
            device.
          </p>
          {offerError ? <p className="auth-error">{offerError}</p> : null}
          <button
            type="button"
            className="primary-btn lg full"
            disabled={offerBusy}
            onClick={() => void acceptBiometricOffer()}
          >
            <Icon name="shield" size={17} /> {offerBusy ? "Setting up…" : "Enable Face ID"}
          </button>
          <button
            type="button"
            className="ghost-btn full u-gap-top"
            disabled={offerBusy}
            onClick={declineBiometricOffer}
          >
            Not Now
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-wrap">
      <div ref={cardRef} className="auth-card">
        <Brand />
        <h1>Unlock Your Ledger</h1>
        <p className="auth-lead">
          Transaction amounts and notes are encrypted end-to-end.{" "}
          {needsWalletSign
            ? "Sign a message with your wallet to derive your decryption key."
            : needsPassphrase
              ? migrating
                ? "Set a device passphrase to encrypt your local key, then unlock."
                : "Enter your device passphrase, then unlock to derive your decryption key."
              : "Your encryption key will be derived from your wallet."}
        </p>
        {canBiometricUnlock ? (
          <button
            type="button"
            className="primary-btn lg full face-id-btn"
            disabled={busy}
            onClick={() => void biometricUnlock()}
          >
            <Icon name="shield" size={17} /> Unlock with Face ID
          </button>
        ) : null}
        {needsPassphrase ? (
          <label className="fld-label">
            {migrating
              ? "New device passphrase"
              : canBiometricUnlock
                ? "Or enter your passphrase"
                : "Device passphrase"}
            <input
              className="text-in"
              type="password"
              autoComplete={migrating ? "new-password" : "current-password"}
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void unlock();
              }}
            />
          </label>
        ) : null}
        {error && <p className="auth-error">{error}</p>}
        <button
          type="button"
          className={canBiometricUnlock ? "ghost-btn full" : "primary-btn lg full"}
          disabled={busy || (needsPassphrase && !passphrase)}
          onClick={() => void unlock()}
        >
          {busy ? "Unlocking…" : needsWalletSign ? "Sign to Unlock" : "Unlock"}
        </button>
        {!idn && walletClient.hasInjected() && (
          <button
            type="button"
            className="ghost-btn full u-gap-top"
            disabled={busy}
            onClick={() => void unlock()}
          >
            Connect Wallet
          </button>
        )}
        <button
          type="button"
          className="ghost-btn full u-gap-top"
          disabled={busy || signingOut}
          onClick={onSignOut}
        >
          {signingOut ? "Signing Out…" : "Sign Out"}
        </button>
      </div>
    </div>
  );
}
