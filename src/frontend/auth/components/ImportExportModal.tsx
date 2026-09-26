import { CsvImportPanel, type CsvImportPreview } from "@/frontend/auth/components/CsvImportPanel";
import { Icon } from "@/frontend/components/ui";
import { api } from "@/frontend/lib/api";
import { ledgerKeyStore } from "@/frontend/lib/crypto/key-store";
import { useModalMotion } from "@/frontend/lib/animate";
import type {
  Category,
  CategoryIndex,
  Expense,
  FinancialWallet,
  LedgerEvent,
  TodoList,
  CapitalPlan,
  Vehicle,
  FuelFill,
} from "@/frontend/lib/types";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  buildBackupPlain,
  decryptBackup,
  downloadEncryptedBackup,
  encryptBackup,
  parseBackupFile,
} from "../lib/encrypted-backup";
import type { LedgerBackupPlain } from "../lib/encrypted-backup";
import type { BackupRestoreResult } from "../lib/restore-backup";
import { downloadEventsCsv } from "../lib/export-events";
import { downloadTodosCsv } from "../lib/export-todos";
import { downloadExpenseCsv } from "../lib/export";
import { downloadPiggiesCsv } from "../lib/export-piggies";
import { parseEventsCsv } from "../lib/import-events";
import { parseTodosCsv, type TodoImportList } from "../lib/import-todos";
import { parseExpenseCsv, type ExpenseImportRow } from "../lib/import";

type ImportExportModalProps = {
  accountAddress: string;
  expenses: Expense[];
  events?: LedgerEvent[];
  todoLists?: TodoList[];
  wallets?: FinancialWallet[];
  categoryIndex?: CategoryIndex;
  activeWalletId?: string;
  savingsTxns?: Expense[];
  capitalPlans?: CapitalPlan[];
  vehicles?: Vehicle[];
  vehicleFills?: FuelFill[];
  onImportExpenses?: (
    rows: ExpenseImportRow[],
    categories?: Category[],
  ) => Promise<{
    imported: number;
    failed: number;
    newCategories: number;
    newSubcategories: number;
  }>;
  onImportEvents?: (
    rows: ReturnType<typeof parseEventsCsv>["rows"],
  ) => Promise<{ imported: number; failed: number }>;
  onImportTodos?: (
    lists: TodoImportList[],
  ) => Promise<{ importedLists: number; importedTasks: number; failed: number }>;
  onRestoreBackup?: (plain: LedgerBackupPlain) => Promise<BackupRestoreResult>;
  onClose: () => void;
};

export function ImportExportModal({
  accountAddress,
  expenses,
  events = [],
  todoLists = [],
  wallets = [],
  categoryIndex,
  activeWalletId,
  savingsTxns = [],
  capitalPlans = [],
  vehicles = [],
  vehicleFills = [],
  onImportExpenses,
  onImportEvents,
  onImportTodos,
  onRestoreBackup,
  onClose,
}: ImportExportModalProps) {
  const [txnExported, setTxnExported] = useState(false);
  const [schedExported, setSchedExported] = useState(false);
  const [todoExported, setTodoExported] = useState(false);
  const [piggiesExported, setPiggiesExported] = useState(false);
  const [backupExported, setBackupExported] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupError, setBackupError] = useState("");
  const [backupResult, setBackupResult] = useState<BackupRestoreResult | null>(null);

  const [txnPreview, setTxnPreview] = useState<ReturnType<typeof parseExpenseCsv> | null>(null);
  const [schedPreview, setSchedPreview] = useState<ReturnType<typeof parseEventsCsv> | null>(null);
  const [todoPreview, setTodoPreview] = useState<ReturnType<typeof parseTodosCsv> | null>(null);

  const [txnBusy, setTxnBusy] = useState(false);
  const [schedBusy, setSchedBusy] = useState(false);
  const [todoBusy, setTodoBusy] = useState(false);
  const modalBusy = backupBusy || txnBusy || schedBusy || todoBusy;
  const scrimRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const { requestClose } = useModalMotion(scrimRef, panelRef, { variant: "center" });

  const [txnResult, setTxnResult] = useState<{
    imported: number;
    failed: number;
    newCategories: number;
    newSubcategories: number;
  } | null>(null);
  const [schedResult, setSchedResult] = useState<{ imported: number; failed: number } | null>(null);
  const [todoResult, setTodoResult] = useState<{
    importedLists: number;
    importedTasks: number;
    failed: number;
  } | null>(null);

  const txnCount = expenses.length;
  const eventCount = events.length;
  const todoTaskCount = todoLists.reduce((n, l) => n + l.tasks.length, 0);

  const flashTimers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  useEffect(
    () => () => {
      flashTimers.current.forEach(clearTimeout);
    },
    [],
  );

  const flash = (setter: (v: boolean) => void) => {
    setter(true);
    flashTimers.current.push(setTimeout(() => setter(false), 2200));
  };

  const isCsvFile = (file: File) => {
    const lower = file.name.toLowerCase();
    return lower.endsWith(".csv") || file.type === "text/csv";
  };

  const exportTransactions = () => {
    downloadExpenseCsv(expenses, wallets, categoryIndex);
    flash(setTxnExported);
  };

  const exportSchedule = () => {
    downloadEventsCsv(events);
    flash(setSchedExported);
  };

  const exportTodos = () => {
    downloadTodosCsv(todoLists);
    flash(setTodoExported);
  };

  const exportPiggies = () => {
    if (!categoryIndex) return;
    downloadPiggiesCsv(savingsTxns, categoryIndex, wallets[0]?.currency);
    flash(setPiggiesExported);
  };

  /** Download an encrypted full-ledger backup (client-only). */
  const exportEncryptedBackup = async () => {
    setBackupError("");
    setBackupBusy(true);
    try {
      const key = ledgerKeyStore.get(accountAddress);
      if (!key) throw new Error("Unlock your ledger before exporting a backup.");
      const [{ user }, { profile }, { consent }] = await Promise.all([
        api.users.me(),
        api.profile.get(),
        api.consent.get(),
      ]);
      const plain = buildBackupPlain({
        address: accountAddress,
        wallets,
        categories: categoryIndex?.allCategories ?? [],
        expenses,
        events,
        todoLists,
        capitalPlans,
        vehicles,
        vehicleFills,
        settings: {
          codename: user.codename,
          notifyEmail: user.notifyEmail,
          timezone: user.timezone,
          emailRemindersEnabled: user.emailRemindersEnabled,
          budgetAlertsEnabled: user.budgetAlertsEnabled,
          tourPreference: profile.tourPreference,
          toursSeen: profile.toursSeen,
          accent: profile.accent,
          navTabs: profile.navTabs,
          navOrder: profile.navOrder,
          consentOptedIn: consent.optedIn,
        },
      });
      const file = await encryptBackup(key, plain);
      downloadEncryptedBackup(file);
      flash(setBackupExported);
    } catch (e) {
      setBackupError(e instanceof Error ? e.message : "Could not export backup.");
    }
    setBackupBusy(false);
  };

  /** Restore from an encrypted backup JSON file. */
  const readBackupFile = async (file: File) => {
    if (!onRestoreBackup) return;
    setBackupError("");
    setBackupResult(null);
    setBackupBusy(true);
    try {
      const key = ledgerKeyStore.get(accountAddress);
      if (!key) throw new Error("Unlock your ledger before restoring a backup.");
      const parsed = parseBackupFile(await file.text());
      const plain = await decryptBackup(key, parsed);
      setBackupResult(await onRestoreBackup(plain));
    } catch (e) {
      setBackupError(e instanceof Error ? e.message : "Could not restore backup.");
    }
    setBackupBusy(false);
  };

  const readTxnFile = async (file: File) => {
    if (!categoryIndex || !onImportExpenses) return;
    if (!isCsvFile(file)) {
      setTxnPreview({
        rows: [],
        errors: [{ row: 0, message: "Please choose a .csv file." }],
        notices: [],
        categories: categoryIndex.allCategories,
        stats: { newCategories: 0, newSubcategories: 0, walletRemapped: 0 },
      });
      setTxnResult(null);
      return;
    }
    const parsed = parseExpenseCsv(
      await file.text(),
      wallets,
      categoryIndex.allCategories,
      activeWalletId,
      expenses.map((e) => e.id),
    );
    setTxnPreview(parsed);
    setTxnResult(null);
  };

  const readSchedFile = async (file: File) => {
    if (!onImportEvents) return;
    if (!isCsvFile(file)) {
      setSchedPreview({
        rows: [],
        errors: [{ row: 0, message: "Please choose a .csv file." }],
        notices: [],
        stats: { skipped: 0 },
      });
      setSchedResult(null);
      return;
    }
    setSchedPreview(
      parseEventsCsv(
        await file.text(),
        events.map((e) => e.id),
      ),
    );
    setSchedResult(null);
  };

  const readTodoFile = async (file: File) => {
    if (!onImportTodos) return;
    if (!isCsvFile(file)) {
      setTodoPreview({
        lists: [],
        errors: [{ row: 0, message: "Please choose a .csv file." }],
        notices: [],
        stats: { newLists: 0, newTasks: 0 },
      });
      setTodoResult(null);
      return;
    }
    setTodoPreview(parseTodosCsv(await file.text(), todoLists));
    setTodoResult(null);
  };

  const runTxnImport = async () => {
    if (!txnPreview?.rows.length || !onImportExpenses || txnBusy) return;
    setTxnBusy(true);
    try {
      const { stats, categories } = txnPreview;
      const taxonomyChanged = stats.newCategories > 0 || stats.newSubcategories > 0;
      setTxnResult(
        await onImportExpenses(txnPreview.rows, taxonomyChanged ? categories : undefined),
      );
      setTxnPreview(null);
    } finally {
      setTxnBusy(false);
    }
  };

  const runSchedImport = async () => {
    if (!schedPreview?.rows.length || !onImportEvents || schedBusy) return;
    setSchedBusy(true);
    try {
      setSchedResult(await onImportEvents(schedPreview.rows));
      setSchedPreview(null);
    } finally {
      setSchedBusy(false);
    }
  };

  const runTodoImport = async () => {
    if (!todoPreview?.lists.length || !onImportTodos || todoBusy) return;
    setTodoBusy(true);
    try {
      setTodoResult(await onImportTodos(todoPreview.lists));
      setTodoPreview(null);
    } finally {
      setTodoBusy(false);
    }
  };

  const txnExtraStats = txnPreview
    ? [
        txnPreview.stats.newCategories > 0
          ? `${txnPreview.stats.newCategories} new categories`
          : "",
        txnPreview.stats.newSubcategories > 0
          ? `${txnPreview.stats.newSubcategories} new subcategories`
          : "",
        txnPreview.stats.walletRemapped > 0
          ? `${txnPreview.stats.walletRemapped} wallet remapped`
          : "",
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  const txnPanelPreview: CsvImportPreview | null = txnPreview
    ? {
        countLabel: txnPreview.rows.length
          ? `${txnPreview.rows.length} transaction${txnPreview.rows.length === 1 ? "" : "s"} ready to import`
          : "No valid transactions found",
        extraStats: txnExtraStats || undefined,
        errors: txnPreview.errors,
        notices: txnPreview.notices,
        canImport: txnPreview.rows.length > 0,
        importButtonLabel: `Import ${txnPreview.rows.length || ""} transaction${txnPreview.rows.length === 1 ? "" : "s"}`,
      }
    : null;

  const schedPanelPreview: CsvImportPreview | null = schedPreview
    ? {
        countLabel: schedPreview.rows.length
          ? `${schedPreview.rows.length} event${schedPreview.rows.length === 1 ? "" : "s"} ready to import`
          : "No valid events found",
        errors: schedPreview.errors,
        notices: schedPreview.notices,
        canImport: schedPreview.rows.length > 0,
        importButtonLabel: `Import ${schedPreview.rows.length || ""} event${schedPreview.rows.length === 1 ? "" : "s"}`,
      }
    : null;

  const todoTaskReady = todoPreview?.lists.reduce((n, l) => n + l.tasks.length, 0) ?? 0;
  const todoExtraStats = todoPreview
    ? [
        todoPreview.stats.newLists > 0
          ? `${todoPreview.stats.newLists} new list${todoPreview.stats.newLists === 1 ? "" : "s"}`
          : "",
        todoPreview.stats.newTasks > 0
          ? `${todoPreview.stats.newTasks} new task${todoPreview.stats.newTasks === 1 ? "" : "s"}`
          : "",
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  const todoPanelPreview: CsvImportPreview | null = todoPreview
    ? {
        countLabel: todoTaskReady
          ? `${todoTaskReady} task${todoTaskReady === 1 ? "" : "s"} across ${todoPreview.lists.length} list${todoPreview.lists.length === 1 ? "" : "s"}`
          : "No valid tasks found",
        extraStats: todoExtraStats || undefined,
        errors: todoPreview.errors,
        notices: todoPreview.notices,
        canImport: todoPreview.lists.length > 0 && todoTaskReady > 0,
        importButtonLabel: `Import ${todoTaskReady || ""} task${todoTaskReady === 1 ? "" : "s"}`,
      }
    : null;

  return createPortal(
    <div
      ref={scrimRef}
      className="modal-scrim center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !modalBusy) requestClose(onClose);
      }}
    >
      <div
        ref={panelRef}
        className="modal sm modal--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ie-modal-title"
      >
        <div className="modal-head">
          <h3 id="ie-modal-title">Exports &amp; Imports</h3>
          <button
            className="icon-btn"
            type="button"
            onClick={() => requestClose(onClose)}
            aria-label="Close"
            disabled={modalBusy}
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="modal-body modal-scroll">
          <div className="dm-sec">
            <p className="dm-lead">
              Download or restore your ledger. Prefer the encrypted backup for private portability;
              use CSV when you need a spreadsheet.
            </p>

            <p className="dm-subhead">Encrypted Backup</p>
            <p className="dm-note">
              Client-side AES pack unlocked with your ledger key. Not stored on the server. Covers
              your ledger data plus account and profile settings (notify email, timezone, accent,
              nav layout).
            </p>
            <button
              className="primary-btn full"
              type="button"
              disabled={backupBusy}
              onClick={() => void exportEncryptedBackup()}
            >
              <Icon name={backupExported ? "check" : "download"} size={17} />
              {backupBusy
                ? "Working…"
                : backupExported
                  ? "Downloaded"
                  : "Download Encrypted Backup"}
            </button>
            {onRestoreBackup ? (
              <label className="ghost-btn full u-gap-top ie-file-label">
                <Icon name="download" size={17} />
                {backupBusy ? "Restoring…" : "Restore Encrypted Backup"}
                <input
                  type="file"
                  accept="application/json,.json"
                  hidden
                  disabled={backupBusy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) void readBackupFile(file);
                  }}
                />
              </label>
            ) : null}
            {backupError ? <p className="auth-error">{backupError}</p> : null}
            {backupResult ? (
              <p className="dm-note">
                Restored {backupResult.expenses} expenses · {backupResult.events} events ·{" "}
                {backupResult.todos} todos
                {backupResult.capitalPlans ? ` · ${backupResult.capitalPlans} capital plans` : ""}
                {backupResult.vehicles ? ` · ${backupResult.vehicles} vehicles` : ""}
                {backupResult.vehicleFills ? ` · ${backupResult.vehicleFills} fills` : ""}
                {backupResult.wallets ? ` · ${backupResult.wallets} wallets` : ""}
                {backupResult.categories ? " · categories" : ""}
                {backupResult.failed ? ` · ${backupResult.failed} failed` : ""}.
              </p>
            ) : null}

            <div className="dm-div" />

            <p className="dm-subhead">Transactions (CSV)</p>
            {onImportExpenses && categoryIndex ? (
              <CsvImportPanel
                importLead="Import transactions from a CSV you exported from Ledger."
                exported={txnExported}
                exportLabel="Export Transactions"
                onExport={exportTransactions}
                countNote={`${txnCount} transaction${txnCount === 1 ? "" : "s"} across all wallets.`}
                onReadFile={readTxnFile}
                preview={txnPanelPreview}
                importBusy={txnBusy}
                onImport={() => void runTxnImport()}
                onClear={() => {
                  setTxnPreview(null);
                  setTxnResult(null);
                }}
                resultSummary={
                  txnResult
                    ? `Imported ${txnResult.imported} transaction${txnResult.imported === 1 ? "" : "s"}${txnResult.newCategories > 0 ? ` · ${txnResult.newCategories} categories created` : ""}${txnResult.newSubcategories > 0 ? ` · ${txnResult.newSubcategories} subcategories created` : ""}${txnResult.failed ? ` · ${txnResult.failed} failed` : ""}.${txnResult.imported > 0 ? " Refresh your views to see them." : ""}`
                    : null
                }
                resultPartial={!!txnResult?.failed}
                footnote="Re-importing skips duplicate transaction IDs. Missing categories are created automatically. Unmatched wallets import into your active wallet."
              />
            ) : (
              <>
                <button className="primary-btn full" type="button" onClick={exportTransactions}>
                  <Icon name={txnExported ? "check" : "download"} size={17} />
                  {txnExported ? "Downloaded" : "Export Transactions"}
                </button>
                <p className="dm-note">
                  {txnCount} transaction{txnCount === 1 ? "" : "s"} across all wallets.
                </p>
              </>
            )}

            <div className="dm-div" />

            <p className="dm-subhead">Schedule</p>
            {onImportEvents ? (
              <CsvImportPanel
                importLead="Import schedule events from a schedule CSV export."
                exported={schedExported}
                exportLabel="Export Schedule"
                onExport={exportSchedule}
                countNote={`${eventCount} event${eventCount === 1 ? "" : "s"} in your calendar.`}
                onReadFile={readSchedFile}
                preview={schedPanelPreview}
                importBusy={schedBusy}
                onImport={() => void runSchedImport()}
                onClear={() => {
                  setSchedPreview(null);
                  setSchedResult(null);
                }}
                resultSummary={
                  schedResult
                    ? `Imported ${schedResult.imported} event${schedResult.imported === 1 ? "" : "s"}${schedResult.failed ? ` · ${schedResult.failed} failed` : ""}.${schedResult.imported > 0 ? " Refresh Schedule to see them." : ""}`
                    : null
                }
                resultPartial={!!schedResult?.failed}
                footnote="Re-importing skips duplicate event IDs. Comments are restored from the CommentsJson column when present."
              />
            ) : (
              <>
                <button className="primary-btn full" type="button" onClick={exportSchedule}>
                  <Icon name={schedExported ? "check" : "download"} size={17} />
                  {schedExported ? "Downloaded" : "Export Schedule"}
                </button>
                <p className="dm-note">
                  {eventCount} event{eventCount === 1 ? "" : "s"} in your calendar.
                </p>
              </>
            )}

            <div className="dm-div" />

            <p className="dm-subhead">TO-DO Lists</p>
            {onImportTodos ? (
              <CsvImportPanel
                importLead="Import to-do lists and tasks from a todos CSV export."
                exported={todoExported}
                exportLabel="Export To-Do Lists"
                onExport={exportTodos}
                countNote={`${todoLists.length} list${todoLists.length === 1 ? "" : "s"} · ${todoTaskCount} task${todoTaskCount === 1 ? "" : "s"}.`}
                onReadFile={readTodoFile}
                preview={todoPanelPreview}
                importBusy={todoBusy}
                onImport={() => void runTodoImport()}
                onClear={() => {
                  setTodoPreview(null);
                  setTodoResult(null);
                }}
                resultSummary={
                  todoResult
                    ? `Imported ${todoResult.importedTasks} task${todoResult.importedTasks === 1 ? "" : "s"}${todoResult.importedLists > 0 ? ` into ${todoResult.importedLists} new list${todoResult.importedLists === 1 ? "" : "s"}` : ""}${todoResult.failed ? ` · ${todoResult.failed} failed` : ""}.${todoResult.importedTasks > 0 ? " Refresh TO-DO List to see them." : ""}`
                    : null
                }
                resultPartial={!!todoResult?.failed}
                footnote="Re-importing skips duplicate task IDs. New lists are created when needed; matching list names merge into existing lists."
              />
            ) : (
              <>
                <button className="primary-btn full" type="button" onClick={exportTodos}>
                  <Icon name={todoExported ? "check" : "download"} size={17} />
                  {todoExported ? "Downloaded" : "Export To-Do Lists"}
                </button>
                <p className="dm-note">
                  {todoLists.length} list{todoLists.length === 1 ? "" : "s"} · {todoTaskCount} task
                  {todoTaskCount === 1 ? "" : "s"}.
                </p>
              </>
            )}

            {categoryIndex ? (
              <>
                <div className="dm-div" />

                <p className="dm-subhead">Piggies</p>
                <button className="primary-btn full" type="button" onClick={exportPiggies}>
                  <Icon name={piggiesExported ? "check" : "download"} size={17} />
                  {piggiesExported ? "Downloaded" : "Export Piggies"}
                </button>
                <p className="dm-note">
                  Every savings category and subcategory with its current balance, target, and
                  deadline. A report, not a re-importable source.
                </p>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
