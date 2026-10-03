import { evaluateExpression, isPlainNumber } from "@/frontend/lib/arithmetic";
import { useModalMotion } from "@/frontend/lib/animate";
import { fmtMoney, getCurrency } from "@/frontend/lib/data";
import type { FinancialWallet } from "@/frontend/lib/types";
import { toast } from "@/frontend/lib/feedback";
import { useMemo, useRef, useState } from "react";
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
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const busy = saving || deleting;
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  /* Dirty baseline for the add/edit form, re-taken whenever the form opens. */
  const [baseline, setBaseline] = useState("");
  const fields = JSON.stringify([name, currency, fundingMode, income, startingBalance]);
  /* `saving` state can't stop two clicks landing in the same task from both
     calling submit before either's setSaving(true) commits — a ref flips
     synchronously, so the second call always sees it. */
  const submittingRef = useRef(false);
  const scrimRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLFormElement>(null);
  const { dismiss } = useModalMotion(scrimRef, panelRef, {
    variant: "center",
    onDismiss: busy ? false : onClose,
    dirty: mode !== "list" && fields !== baseline,
  });

  const startAdd = () => {
    setMode("add");
    setEditId(null);
    setName("");
    setCurrency("MYR");
    setFundingMode("monthly");
    setIncome("0");
    setStartingBalance("0");
    setBaseline(JSON.stringify(["", "MYR", "monthly", "0", "0"]));
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
    setBaseline(
      JSON.stringify([
        w.name,
        w.currency,
        w.fundingMode,
        String(w.income),
        String(w.startingBalance),
      ]),
    );
    setError("");
  };

  const backToList = () => {
    setMode("list");
    setError("");
  };

  /* Only the active funding field counts; the other is zeroed on save. */
  const amountText = fundingMode === "monthly" ? income : startingBalance;
  const amountValue = fundingMode === "monthly" ? incomeEvaluated : startingBalanceEvaluated;
  const amountError =
    amountValue === null
      ? amountText.trim()
        ? "Enter a valid amount, e.g. 3500 or 2000+1500."
        : "Enter an amount, or 0."
      : amountValue < 0
        ? "Amount cannot be negative."
        : "";

  const submit = async () => {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    if (amountError || amountValue === null) {
      setError(amountError);
      return;
    }
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSaving(true);
    setError("");
    try {
      await onSave({
        id: editId ?? undefined,
        name: name.trim(),
        currency,
        fundingMode,
        income: fundingMode === "monthly" ? Math.round(amountValue) : 0,
        startingBalance: fundingMode === "starting" ? Math.round(amountValue) : 0,
      });
      toast(mode === "add" ? "Wallet added" : "Wallet updated");
      setMode("list");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save wallet");
    } finally {
      submittingRef.current = false;
      setSaving(false);
    }
  };

  /** Errors propagate to the ConfirmDialog, which shows them inline. */
  const remove = async (id: string) => {
    setDeleting(true);
    try {
      await onDelete(id);
      toast("Wallet deleted");
      setConfirmDelete(false);
      setMode("list");
    } finally {
      setDeleting(false);
    }
  };

  const editingWallet = editId ? wallets.find((w) => w.id === editId) : undefined;
  const canDelete = mode === "edit" && !!editingWallet && wallets.length > 1;

  const title = mode === "list" ? "Wallets" : mode === "add" ? "Add Wallet" : "Edit Wallet";

  return createPortal(
    <div
      ref={scrimRef}
      className="modal-scrim center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) dismiss();
      }}
    >
      <form
        ref={panelRef}
        className="modal sm"
        role="dialog"
        aria-modal="true"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (mode !== "list") void submit();
        }}
      >
        <div className="modal-head">
          <h3>{title}</h3>
          <button
            className="icon-btn"
            type="button"
            onClick={dismiss}
            aria-label="Close"
            disabled={busy}
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="modal-body modal-scroll">
          <p className="journal-note">
            Creating, renaming, and deleting wallets requires a connection. Switching between
            downloaded wallets works offline.
          </p>
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
                  {amountError ? <p className="fld-error">{amountError}</p> : null}
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
                  {amountError ? <p className="fld-error">{amountError}</p> : null}
                </>
              )}

              {error ? (
                <p className="auth-error auth-error--gap" role="alert">
                  {error}
                </p>
              ) : null}
            </div>
          )}
        </div>

        {mode !== "list" ? (
          <div className="modal-foot">
            {canDelete ? (
              <button
                className="ghost-btn danger"
                type="button"
                disabled={busy}
                onClick={() => setConfirmDelete(true)}
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            ) : (
              <span />
            )}
            <div className="mf-right">
              <button className="ghost-btn" type="button" onClick={backToList} disabled={busy}>
                Back
              </button>
              <button
                className="primary-btn"
                type="submit"
                disabled={busy || !name.trim() || !!amountError}
              >
                {saving ? "Saving…" : mode === "add" ? "Add Wallet" : "Save Changes"}
              </button>
            </div>
          </div>
        ) : null}
      </form>
      {confirmDelete && editingWallet ? (
        <ConfirmDialog
          title="Delete Wallet"
          message={`Delete "${editingWallet.name}"? A wallet that still has transactions can't be deleted; move or delete them first. This cannot be undone.`}
          requireText={editingWallet.name.trim()}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => remove(editingWallet.id)}
        />
      ) : null}
    </div>,
    document.body,
  );
}
