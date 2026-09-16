import { evaluateExpression, isPlainNumber } from "@/frontend/lib/arithmetic";
import { useModalMotion } from "@/frontend/lib/animate";
import { fmtMoney, getCurrency } from "@/frontend/lib/data";
import type { FinancialWallet } from "@/frontend/lib/types";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CurrencyPicker } from "./CurrencyPicker";
import { FadeIn } from "@/frontend/components/FadeIn";
import { ConfirmDialog, Icon, Segmented, WalletPicker } from "./ui";

/*
 * Wallets
 * ───────
 *   WalletSwitcher    — topbar dropdown to switch the active wallet
 *   WalletManageModal — list / add / edit / delete wallets
 */

type WalletSwitcherProps = {
  wallets: FinancialWallet[];
  activeId: string;
  onChange: (id: string) => void;
  onManage: () => void;
};

export function WalletSwitcher({ wallets, activeId, onChange, onManage }: WalletSwitcherProps) {
  return (
    <WalletPicker wallets={wallets} value={activeId} onChange={onChange} onManage={onManage} />
  );
}

type WalletManageModalProps = {
  wallets: FinancialWallet[];
  activeId: string;
  onSave: (
    data: Partial<FinancialWallet> & { id?: string; name?: string; currency?: string },
  ) => Promise<unknown>;
  onDelete: (id: string) => Promise<unknown>;
  onClose: () => void;
};

export function WalletManageModal({ wallets, onSave, onDelete, onClose }: WalletManageModalProps) {
  const [mode, setMode] = useState<"list" | "add" | "edit">("list");
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("MYR");
  const [fundingMode, setFundingMode] = useState<"monthly" | "starting">("monthly");
  const [income, setIncome] = useState("");
  const [startingBalance, setStartingBalance] = useState("");
  const incomeEvaluated = useMemo(() => evaluateExpression(income), [income]);
  const incomeIsExpression = incomeEvaluated !== null && !isPlainNumber(income);
  const startingBalanceEvaluated = useMemo(
    () => evaluateExpression(startingBalance),
    [startingBalance],
  );
  const startingBalanceIsExpression =
    startingBalanceEvaluated !== null && !isPlainNumber(startingBalance);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const scrimRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const { requestClose } = useModalMotion(scrimRef, panelRef, { variant: "center" });

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy && !confirmDelete) requestClose(onClose);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [busy, confirmDelete, onClose, requestClose]);

  const startAdd = () => {
    setMode("add");
    setEditId(null);
    setName("");
    setCurrency("MYR");
    setFundingMode("monthly");
    setIncome("0");
    setStartingBalance("0");
    setError("");
  };

  const startEdit = (w: FinancialWallet) => {
    setMode("edit");
    setEditId(w.id);
    setName(w.name);
    setCurrency(w.currency);
    setFundingMode(w.fundingMode);
    setIncome(String(w.income));
    setStartingBalance(String(w.startingBalance));
    setError("");
  };

  const backToList = () => {
    setMode("list");
    setError("");
  };

  const submit = async () => {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onSave({
        id: editId ?? undefined,
        name: name.trim(),
        currency,
        fundingMode,
        income: fundingMode === "monthly" ? Math.max(0, Math.round(incomeEvaluated ?? 0)) : 0,
        startingBalance:
          fundingMode === "starting" ? Math.max(0, Math.round(startingBalanceEvaluated ?? 0)) : 0,
      });
      setMode("list");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save wallet");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    setError("");
    try {
      await onDelete(id);
      setMode("list");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete wallet");
    } finally {
      setBusy(false);
    }
  };

  const title = mode === "list" ? "Wallets" : mode === "add" ? "Add Wallet" : "Edit Wallet";

  return createPortal(
    <div
      ref={scrimRef}
      className="modal-scrim center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy && !confirmDelete) requestClose(onClose);
      }}
    >
      <div ref={panelRef} className="modal sm" role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>{title}</h3>
          <button
            className="icon-btn"
            type="button"
            onClick={() => requestClose(onClose)}
            aria-label="Close"
            disabled={busy}
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="modal-body modal-scroll">
          {mode === "list" ? (
            <div className="dm-sec">
              <span className="fld-label">Your wallets</span>
              <p className="dm-lead">
                Track spending in separate purses — each wallet has its own currency, income, and
                budgets.
              </p>
              <div className="session-list">
                {wallets.map((w) => {
                  const cur = getCurrency(w.currency);
                  return (
                    <div key={w.id} className="session-row">
                      <div className="session-main">
                        <div className="session-device">
                          {w.name}
                          {w.isDefault ? <span className="wallet-badge">Default</span> : null}
                        </div>
                        <div className="session-meta num">
                          {cur.code} · {cur.symbol} ·{" "}
                          {w.fundingMode === "starting"
                            ? `Starting ${cur.symbol}${w.startingBalance.toLocaleString()}`
                            : `Income ${cur.symbol}${w.income.toLocaleString()}/mo`}
                        </div>
                      </div>
                      <button className="ghost-btn" type="button" onClick={() => startEdit(w)}>
                        Edit
                      </button>
                    </div>
                  );
                })}
              </div>
              <button className="primary-btn full u-gap-top" type="button" onClick={startAdd}>
                <Icon name="plus" size={17} /> Add Wallet
              </button>
              <p className="dm-note">
                {wallets.length} wallet{wallets.length === 1 ? "" : "s"} · switch between them from
                the top bar.
              </p>
            </div>
          ) : (
            <div className="dm-sec">
              <span className="fld-label">Wallet details</span>
              <p className="dm-lead">
                {mode === "add"
                  ? "Give this wallet a name, pick its currency, and choose how to fund it."
                  : "Update the wallet name or funding settings."}
              </p>

              <label className="fld-label" htmlFor="wallet-name">
                Name
              </label>
              <input
                id="wallet-name"
                className="text-in wallet-field"
                type="text"
                placeholder="e.g. Cash, Maybank, Travel USD"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />

              <label className="fld-label" htmlFor="wallet-currency">
                Currency
              </label>
              <CurrencyPicker
                id="wallet-currency"
                className="wallet-field"
                value={currency}
                onChange={setCurrency}
                disabled={mode === "edit"}
              />
              {mode === "edit" ? (
                <p className="dm-note dm-note--pull">Currency cannot be changed after creation.</p>
              ) : null}

              <label className="fld-label">Funding</label>
              <div className="wallet-seg">
                <Segmented
                  options={[
                    { v: "monthly", label: "Monthly Income" },
                    { v: "starting", label: "Starting Balance" },
                  ]}
                  value={fundingMode}
                  onChange={setFundingMode}
                />
              </div>
              <p className="dm-note dm-note--pull">
                {fundingMode === "monthly"
                  ? "Set a monthly income budget. Add salary, wages, and bonuses as income transactions."
                  : "Set how much money this wallet started with. Track top-ups as income transactions."}
              </p>

              {fundingMode === "monthly" ? (
                <>
                  <label className="fld-label">Monthly Income</label>
                  {incomeIsExpression ? (
                    <FadeIn className="amount-live-total" as="div">
                      = {fmtMoney(incomeEvaluated, { currency })}
                    </FadeIn>
                  ) : null}
                  <div className="amount-field compact wallet-amount">
                    <span className="amount-cur">{getCurrency(currency).symbol}</span>
                    <input
                      type="text"
                      inputMode="text"
                      placeholder="0"
                      value={income}
                      onChange={(e) => setIncome(e.target.value)}
                      onBlur={() => {
                        if (incomeIsExpression) setIncome(String(incomeEvaluated));
                      }}
                    />
                  </div>
                </>
              ) : (
                <>
                  <label className="fld-label">Starting Balance</label>
                  {startingBalanceIsExpression ? (
                    <FadeIn className="amount-live-total" as="div">
                      = {fmtMoney(startingBalanceEvaluated, { currency })}
                    </FadeIn>
                  ) : null}
                  <div className="amount-field compact wallet-amount">
                    <span className="amount-cur">{getCurrency(currency).symbol}</span>
                    <input
                      type="text"
                      inputMode="text"
                      placeholder="0"
                      value={startingBalance}
                      onChange={(e) => setStartingBalance(e.target.value)}
                      onBlur={() => {
                        if (startingBalanceIsExpression)
                          setStartingBalance(String(startingBalanceEvaluated));
                      }}
                    />
                  </div>
                </>
              )}

              {error ? <p className="auth-error">{error}</p> : null}

              {mode === "edit" && editId && wallets.length > 1 ? (
                <>
                  <div className="dm-div" />
                  <span className="fld-label">Remove wallet</span>
                  <p className="dm-lead">
                    Delete this wallet only if it has no transactions. This cannot be undone.
                  </p>
                  <button
                    className="ghost-btn danger full"
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirmDelete(true)}
                  >
                    {busy ? "Deleting…" : "Delete Wallet"}
                  </button>
                </>
              ) : null}

              <div className="wallet-form-actions">
                <button className="ghost-btn full" type="button" onClick={backToList}>
                  Back
                </button>
                <button
                  className="primary-btn full"
                  type="button"
                  disabled={busy || !name.trim()}
                  onClick={submit}
                >
                  {busy ? "Saving…" : mode === "add" ? "Add Wallet" : "Save Changes"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      {confirmDelete ? (
        <ConfirmDialog
          title="Delete Wallet"
          message="Delete this wallet? This cannot be undone."
          onCancel={() => setConfirmDelete(false)}
          onConfirm={async () => {
            if (editId) await remove(editId);
            setConfirmDelete(false);
          }}
        />
      ) : null}
    </div>,
    document.body,
  );
}
