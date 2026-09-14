import { LedgerApp } from "@/frontend/app/LedgerApp";
import { AuthScreen, getSavedAccount, logoutSession, UnlockScreen } from "@/frontend/auth";
import { TermsGate } from "@/frontend/auth/components/TermsGate";
import { LoadingBloom } from "@/frontend/components/LoadingBloom";
import { ThemeToggle } from "@/frontend/components/ThemeToggle";
import { api, ApiError } from "@/frontend/lib/api";
import { ledgerKeyStore, seriesKeyStore } from "@/frontend/lib/crypto/key-store";
import { unlockLedgerKey } from "@/frontend/lib/crypto/unlock";
import { identityStorage } from "@/frontend/auth/lib/identity-storage";
import { sessionSecrets } from "@/frontend/auth/lib/session-secrets";
import { isSessionTrustFresh, markSessionVerified } from "@/frontend/auth/lib/session-trust";
import { isOfflineFailure } from "@/frontend/lib/net/offline-failure";
import { clearCipherCacheForAddress } from "@/frontend/lib/pwa/cipher-cache";
import { ThemeProvider } from "@/frontend/lib/hooks/useTheme";
import { TERMS_VERSION } from "@/lib/legal";
import type { Account } from "@/frontend/lib/types";
import { useEffect, useState } from "react";

/**
 * App root: restores the server session on boot, then renders either
 * the authenticated LedgerApp or the AuthScreen.
 */
export function Root() {
  const [account, setAccount] = useState<Account | null>(null);
  const [booting, setBooting] = useState(true);
  const [cryptoReady, setCryptoReady] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [termsVersion, setTermsVersion] = useState<string | undefined>(undefined);
  const [termsChecked, setTermsChecked] = useState(false);
  /* True once the server has actually answered (accepted or rejected) —
     distinct from termsVersion itself being undefined, which also happens
     on a first-ever check and (below) on an offline check failure. Gating
     on an *unknown* answer offline would trap the user in TermsGate, whose
     only exit (PATCH /profile) cannot succeed offline. */
  const [termsKnown, setTermsKnown] = useState(false);

  /** Re-fetch whether this account has accepted the current Terms. */
  const checkTerms = () => {
    setTermsChecked(false);
    api.profile
      .get()
      .then(({ profile }) => {
        setTermsVersion(profile.termsVersion);
        setTermsKnown(true);
      })
      .catch((err) => {
        if (!isOfflineFailure(err)) {
          // A definite rejection (401/403/404) — treat as "not accepted", same as before.
          setTermsVersion(undefined);
          setTermsKnown(true);
        }
        // Offline: leave termsKnown as it was — don't downgrade a previously
        // known answer, and don't gate on an answer we never got.
      })
      .finally(() => setTermsChecked(true));
  };

  // Restore session; prefer locally-stored codename when it matches.
  useEffect(() => {
    const saved = getSavedAccount();
    if (saved) {
      // Local-first boot: render UnlockScreen immediately from localStorage —
      // zero network needed — rather than waiting on auth.me() to resolve.
      setAccount(saved);
      setBooting(false);
    }

    checkTerms(); // fired alongside auth.me() below — same session cookie, no added latency
    api.auth
      .me()
      .then(async ({ account: remote }) => {
        markSessionVerified(remote.address);
        const merged =
          saved && saved.address.toLowerCase() === remote.address.toLowerCase()
            ? { ...remote, codename: saved.codename, injected: saved.injected }
            : remote;
        setAccount(merged);
        const idn = identityStorage.find(merged.address);
        const session = sessionSecrets.get(merged.address);
        /* Only auto-unlock from in-memory sessionSecrets — never from localStorage plaintext. */
        const privateKey = session?.privateKey;
        if (privateKey && !idn?.injected) {
          try {
            await unlockLedgerKey({
              ...idn!,
              privateKey,
              mnemonic: session.mnemonic,
            });
            setCryptoReady(true);
          } catch {
            setCryptoReady(false);
          }
        }
      })
      .catch((err) => {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          // A definite, server-answered rejection — sign out, online or not.
          setAccount(null);
          return;
        }
        // Offline / server unreachable: keep the locally-restored account
        // (if any) so UnlockScreen stays reachable, but bound how long a
        // session may be trusted with no server confirmation at all.
        if (saved && !isSessionTrustFresh(saved.address)) {
          setAccount(null);
          void clearCipherCacheForAddress(saved.address);
        }
      })
      .finally(() => setBooting(false));
  }, []);

  const signOut = async () => {
    if (signingOut) return;

    setSigningOut(true);
    try {
      ledgerKeyStore.clear();
      seriesKeyStore.clear();
      sessionSecrets.clearAll();
      await logoutSession();
      setAccount(null);
      setCryptoReady(false);
      setTermsVersion(undefined);
      setTermsChecked(false);
      setTermsKnown(false);
    } finally {
      setSigningOut(false);
    }
  };

  if (booting || (account && !termsChecked)) {
    return (
      <ThemeProvider>
        <div className="app app--loading">
          <LoadingBloom />
        </div>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      {account ? (
        termsKnown && termsVersion !== TERMS_VERSION ? (
          <TermsGate onAccepted={setTermsVersion} onSignOut={signOut} signingOut={signingOut} />
        ) : cryptoReady || ledgerKeyStore.isUnlocked(account.address) ? (
          <LedgerApp
            key={account.address}
            account={account}
            onSignOut={signOut}
            signingOut={signingOut}
          />
        ) : (
          <UnlockScreen
            account={account}
            onUnlocked={() => setCryptoReady(true)}
            onSignOut={signOut}
            signingOut={signingOut}
          />
        )
      ) : (
        <>
          <ThemeToggle className="auth-theme-toggle" />
          <AuthScreen
            onAuth={(acc) => {
              setAccount(acc);
              setCryptoReady(true);
              checkTerms();
            }}
          />
        </>
      )}
    </ThemeProvider>
  );
}
