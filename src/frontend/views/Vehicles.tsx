import { ReadableValue } from "@/frontend/components/ReadableValue";
import { DatePicker } from "@/frontend/components/DateTimePicker";
import { ConfirmDialog, EmptyState, Icon, InsightFeed } from "@/frontend/components/ui";
import { dayLabel, fmtMoney, TODAY_ISO } from "@/frontend/lib/data";
import { useEnter, useModalMotion } from "@/frontend/lib/animate";
import { toast } from "@/frontend/lib/feedback";
import {
  assessVehicleFuel,
  computeFuelInsights,
  FUEL_MIN_FILLS,
  VEHICLE_TYPES,
} from "@/frontend/lib/fuelInsights";
import type { FuelFill, Vehicle, VehicleType } from "@/frontend/lib/types";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

/*
 * Vehicles — fleet tracker + Fuel Insights
 * ─────────────────────────────────────────
 * Each vehicle (car, EV, bike, van) tracks its own fill/charge history.
 * VEHICLE_TYPES supplies every unit and noun the view renders, so an EV
 * reads as kWh/charge/kWh-per-100km throughout while a car reads litres.
 * Fuel Insights runs per selected vehicle from the shared ranked-card model.
 */

type VehiclesProps = {
  vehicles: Vehicle[];
  fills: FuelFill[];
  currency: string;
  onSaveVehicle: (data: Omit<Vehicle, "id" | "createdAt"> & { id?: string }) => Promise<Vehicle>;
  onDeleteVehicle: (id: string) => Promise<unknown>;
  onSaveFill: (data: Omit<FuelFill, "id"> & { id?: string }) => Promise<FuelFill>;
  onDeleteFill: (id: string) => Promise<unknown>;
  onLogFill: (vehicle: Vehicle, fill: FuelFill) => void;
  /** Expense ids that still exist, so a fill whose payment was deleted can be re-logged. */
  linkedExpenseIds: Set<string>;
};

/** Imperative handle so the shell's quick-add FAB can switch the active vehicle. */
export type VehiclesHandle = {
  select: (id: string) => void;
  openAddFillFor: (id: string) => void;
};

type EditorMode =
  | { type: "add-vehicle" }
  | { type: "edit-vehicle"; vehicleId: string }
  | { type: "add-fill"; vehicleId: string }
  | { type: "edit-fill"; fillId: string }
  | null;

const VEHICLE_TYPE_LIST: VehicleType[] = ["car", "ev", "bike", "van"];

type VehicleDraft = Omit<Vehicle, "id" | "createdAt">;
type FillDraft = Omit<FuelFill, "id" | "vehicleId" | "expenseId">;
type VehicleMeta = (typeof VEHICLE_TYPES)[VehicleType];

/** Parse an optional decimal draft: undefined when blank, null when invalid. */
function parseDecimal(raw: string): number | null | undefined {
  const text = raw.trim();
  if (!text) return undefined;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const isPositive = (n: number | null | undefined): n is number => n != null && n > 0;

/** "fill-up" -> "Fill-Up" */
const titleCase = (text: string) =>
  text.replace(/(^|[\s-])(\w)/g, (_, gap: string, ch: string) => gap + ch.toUpperCase());
const sentenceCase = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Add / edit vehicle dialog. Errors from `onSave` stay inline. */
function VehicleEditor({
  initial,
  deleting,
  onSave,
  onDelete,
  onClose,
}: {
  initial?: Vehicle;
  deleting: boolean;
  onSave: (draft: VehicleDraft) => Promise<void>;
  onDelete: () => void;
  onClose: () => void;
}) {
  const editing = !!initial;
  const [name, setName] = useState(initial?.name ?? "");
  const [model, setModel] = useState(initial?.model ?? "");
  const [type, setType] = useState<VehicleType>(initial?.type ?? "car");
  const [plate, setPlate] = useState(initial?.plate ?? "");
  const [odometerStart, setOdometerStart] = useState(
    initial?.odometerStart != null ? String(initial.odometerStart) : "",
  );
  const [tankCapacity, setTankCapacity] = useState(
    initial?.tankCapacity != null ? String(initial.tankCapacity) : "",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  /* `saving` state alone can't stop two clicks landing in the same task. */
  const savingRef = useRef(false);
  const busy = saving || deleting;
  const fields = JSON.stringify([name, model, type, plate, odometerStart, tankCapacity]);
  const [baseline] = useState(fields);
  const scrimRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLFormElement>(null);
  const { dismiss } = useModalMotion(scrimRef, panelRef, {
    variant: "center",
    onDismiss: busy ? false : onClose,
    dirty: fields !== baseline,
  });

  const odometer = parseDecimal(odometerStart);
  const tank = parseDecimal(tankCapacity);
  const valid = !!name.trim() && odometer !== null && tank !== null;

  const submit = async () => {
    if (!name.trim() || odometer === null || tank === null || busy || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      await onSave({
        name: name.trim(),
        model: model.trim(),
        type,
        plate: plate.trim() || undefined,
        glyph: VEHICLE_TYPES[type].glyph,
        odometerStart: odometer || undefined,
        tankCapacity: tank || undefined,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save this vehicle. Please try again.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

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
          void submit();
        }}
      >
        <div className="modal-head">
          <h3>{editing ? "Edit Vehicle" : "Add Vehicle"}</h3>
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
          <div className="dm-sec">
            <label className="fld-label">Type</label>
            <div className="capital-template-row">
              {VEHICLE_TYPE_LIST.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={"fchip" + (type === t ? " active" : "")}
                  onClick={() => setType(t)}
                >
                  {VEHICLE_TYPES[t].glyph} {VEHICLE_TYPES[t].label}
                </button>
              ))}
            </div>

            <label className="fld-label" htmlFor="vehicle-name">
              Name
            </label>
            <input
              id="vehicle-name"
              className="text-in wallet-field"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              aria-required="true"
              placeholder="e.g. My Daily Driver"
            />

            <label className="fld-label" htmlFor="vehicle-model">
              Model
            </label>
            <input
              id="vehicle-model"
              className="text-in wallet-field"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="e.g. Honda Civic 2022"
            />

            <label className="fld-label" htmlFor="vehicle-plate">
              Plate (optional)
            </label>
            <input
              id="vehicle-plate"
              className="text-in wallet-field"
              value={plate}
              onChange={(e) => setPlate(e.target.value)}
            />

            <label className="fld-label" htmlFor="vehicle-odo-start">
              Starting odometer, km (optional)
            </label>
            <input
              id="vehicle-odo-start"
              className="text-in wallet-field"
              type="text"
              inputMode="decimal"
              value={odometerStart}
              onChange={(e) => setOdometerStart(e.target.value)}
              aria-invalid={odometer === null}
              aria-describedby={odometer === null ? "vehicle-odo-start-err" : undefined}
              placeholder="0"
            />
            {odometer === null ? (
              <p className="fld-error" id="vehicle-odo-start-err">
                Enter a number, 0 or more.
              </p>
            ) : null}

            <label className="fld-label" htmlFor="vehicle-tank">
              {VEHICLE_TYPES[type].mode === "power"
                ? "Battery capacity, kWh (optional)"
                : "Tank capacity, litres (optional)"}
            </label>
            <input
              id="vehicle-tank"
              className="text-in wallet-field"
              type="text"
              inputMode="decimal"
              value={tankCapacity}
              onChange={(e) => setTankCapacity(e.target.value)}
              aria-invalid={tank === null}
              aria-describedby={tank === null ? "vehicle-tank-err" : undefined}
              placeholder="0"
            />
            {tank === null ? (
              <p className="fld-error" id="vehicle-tank-err">
                Enter a number, 0 or more.
              </p>
            ) : null}

            {error ? (
              <p className="auth-error auth-error--gap" role="alert">
                {error}
              </p>
            ) : null}
          </div>
        </div>
        <div className="modal-foot">
          {editing ? (
            <button className="ghost-btn danger" type="button" onClick={onDelete} disabled={busy}>
              {deleting ? "Deleting…" : "Delete"}
            </button>
          ) : (
            <span />
          )}
          <div className="mf-right">
            <button className="ghost-btn" type="button" onClick={dismiss} disabled={busy}>
              Cancel
            </button>
            <button className="primary-btn" type="submit" disabled={!valid || busy}>
              {saving ? "Saving…" : editing ? "Save Changes" : "Add Vehicle"}
            </button>
          </div>
        </div>
      </form>
    </div>,
    document.body,
  );
}

/** Add / edit fuel or charge record dialog. Errors from `onSave` stay inline. */
function FillEditor({
  initial,
  meta,
  deleting,
  onSave,
  onDelete,
  onClose,
}: {
  initial?: FuelFill;
  meta: VehicleMeta;
  deleting: boolean;
  onSave: (draft: FillDraft) => Promise<void>;
  onDelete: () => void;
  onClose: () => void;
}) {
  const editing = !!initial;
  const [date, setDate] = useState(initial?.date ?? TODAY_ISO);
  const [price, setPrice] = useState(initial ? String(initial.price) : "");
  const [quantity, setQuantity] = useState(initial ? String(initial.quantity) : "");
  const [odometer, setOdometer] = useState(
    initial?.odometer != null ? String(initial.odometer) : "",
  );
  const [station, setStation] = useState(initial?.station ?? "");
  const [partial, setPartial] = useState(initial?.partial ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const savingRef = useRef(false);
  const busy = saving || deleting;
  const fields = JSON.stringify([date, price, quantity, odometer, station, partial]);
  const [baseline] = useState(fields);
  const scrimRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLFormElement>(null);
  const { dismiss } = useModalMotion(scrimRef, panelRef, {
    variant: "center",
    onDismiss: busy ? false : onClose,
    dirty: fields !== baseline,
  });

  const priceNum = parseDecimal(price);
  const quantityNum = parseDecimal(quantity);
  const odometerNum = parseDecimal(odometer);
  const priceBad = price.trim() !== "" && !isPositive(priceNum);
  const quantityBad = quantity.trim() !== "" && !isPositive(quantityNum);
  const odometerBad = odometerNum === null;
  const valid = !!date && isPositive(priceNum) && isPositive(quantityNum) && !odometerBad;
  const noun = meta.fillNoun;

  const submit = async () => {
    if (
      !date ||
      !isPositive(priceNum) ||
      !isPositive(quantityNum) ||
      odometerNum === null ||
      busy ||
      savingRef.current
    )
      return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      await onSave({
        date,
        price: priceNum,
        quantity: quantityNum,
        odometer: odometerNum,
        station: station.trim(),
        partial,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : `Couldn't save this ${noun}. Please try again.`);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

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
          void submit();
        }}
      >
        <div className="modal-head">
          <h3>{editing ? `Edit ${titleCase(noun)}` : titleCase(meta.fillVerb)}</h3>
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
          <div className="dm-sec">
            <label className="fld-label">Date</label>
            <DatePicker value={date} onChange={setDate} className="wallet-field" />

            <label className="fld-label" htmlFor="fill-price">
              Total Price
            </label>
            <input
              id="fill-price"
              className="text-in wallet-field"
              type="text"
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              aria-required="true"
              aria-invalid={priceBad}
              aria-describedby={priceBad ? "fill-price-err" : undefined}
              placeholder="0"
            />
            {priceBad ? (
              <p className="fld-error" id="fill-price-err">
                Enter a price above 0.
              </p>
            ) : null}

            <label className="fld-label" htmlFor="fill-quantity">
              {sentenceCase(meta.unitLong)}s ({meta.unit})
            </label>
            <input
              id="fill-quantity"
              className="text-in wallet-field"
              type="text"
              inputMode="decimal"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              aria-required="true"
              aria-invalid={quantityBad}
              aria-describedby={quantityBad ? "fill-quantity-err" : undefined}
              placeholder="0"
            />
            {quantityBad ? (
              <p className="fld-error" id="fill-quantity-err">
                Enter an amount above 0.
              </p>
            ) : null}

            <label className="fld-label" htmlFor="fill-odometer">
              Odometer, km (optional)
            </label>
            <input
              id="fill-odometer"
              className="text-in wallet-field"
              type="text"
              inputMode="decimal"
              value={odometer}
              onChange={(e) => setOdometer(e.target.value)}
              aria-invalid={odometerBad}
              aria-describedby={odometerBad ? "fill-odometer-err" : undefined}
              placeholder="0"
            />
            {odometerBad ? (
              <p className="fld-error" id="fill-odometer-err">
                Enter a number, 0 or more.
              </p>
            ) : null}

            <label className="fld-label" htmlFor="fill-station">
              {sentenceCase(meta.stationNoun)} (optional)
            </label>
            <input
              id="fill-station"
              className="text-in wallet-field"
              value={station}
              onChange={(e) => setStation(e.target.value)}
            />

            <label className="toggle-line tight">
              <input
                type="checkbox"
                checked={partial}
                onChange={(e) => setPartial(e.target.checked)}
              />
              Partial {noun} — did not fill to full
            </label>

            {error ? (
              <p className="auth-error auth-error--gap" role="alert">
                {error}
              </p>
            ) : null}
          </div>
        </div>
        <div className="modal-foot">
          {editing ? (
            <button className="ghost-btn danger" type="button" onClick={onDelete} disabled={busy}>
              {deleting ? "Deleting…" : "Delete"}
            </button>
          ) : (
            <span />
          )}
          <div className="mf-right">
            <button className="ghost-btn" type="button" onClick={dismiss} disabled={busy}>
              Cancel
            </button>
            <button className="primary-btn" type="submit" disabled={!valid || busy}>
              {saving ? "Saving…" : editing ? "Save Changes" : `Add ${titleCase(noun)}`}
            </button>
          </div>
        </div>
      </form>
    </div>,
    document.body,
  );
}

export const Vehicles = forwardRef<VehiclesHandle, VehiclesProps>(function Vehicles(
  {
    vehicles,
    fills,
    currency,
    onSaveVehicle,
    onDeleteVehicle,
    onSaveFill,
    onDeleteFill,
    onLogFill,
    linkedExpenseIds,
  },
  ref,
) {
  const [vehicleList, setVehicleList] = useState(vehicles);
  const [fillList, setFillList] = useState(fills);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorMode>(null);
  /* Id of the vehicle or fill being deleted right now. */
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<
    { type: "vehicle"; id: string } | { type: "fill"; id: string } | null
  >(null);

  useEffect(() => setVehicleList(vehicles), [vehicles]);
  useEffect(() => setFillList(fills), [fills]);

  useEffect(() => {
    if (selectedId && vehicleList.some((v) => v.id === selectedId)) return;
    setSelectedId(vehicleList[0]?.id ?? null);
  }, [vehicleList, selectedId]);

  const money = useCallback((n: number) => fmtMoney(n, { currency }), [currency]);
  const selectedVehicle = vehicleList.find((v) => v.id === selectedId) ?? null;
  const selectedMeta = VEHICLE_TYPES[selectedVehicle?.type ?? "car"];

  const fillsFor = (vehicleId: string) =>
    fillList.filter((f) => f.vehicleId === vehicleId).sort((a, b) => (a.date < b.date ? 1 : -1));

  const selectedFills = useMemo(
    () =>
      selectedVehicle
        ? fillList
            .filter((f) => f.vehicleId === selectedVehicle.id)
            .sort((a, b) => (a.date < b.date ? 1 : -1))
        : [],
    [selectedVehicle, fillList],
  );
  const assessment = useMemo(() => assessVehicleFuel(selectedFills), [selectedFills]);
  const insights = useMemo(() => {
    if (assessment.status !== "ready" || !selectedVehicle) return [];

    return computeFuelInsights(assessment.metrics, selectedMeta, assessment.confidence, {
      money,
    });
  }, [assessment, selectedMeta, selectedVehicle, money]);

  /* Save handlers let failures propagate: the editor shows them inline. */
  const saveVehicle = async (draft: VehicleDraft) => {
    const id = editor?.type === "edit-vehicle" ? editor.vehicleId : undefined;
    const saved = await onSaveVehicle(id ? { id, ...draft } : draft);
    setVehicleList((prev) =>
      id ? prev.map((v) => (v.id === saved.id ? saved : v)) : [...prev, saved],
    );
    setSelectedId(saved.id);
    setEditor(null);
    toast(id ? "Vehicle updated" : "Vehicle added");
  };

  const saveFill = async (draft: FillDraft) => {
    if (!editor || (editor.type !== "add-fill" && editor.type !== "edit-fill")) return;
    const existing =
      editor.type === "edit-fill" ? fillList.find((f) => f.id === editor.fillId) : undefined;
    const vehicleId = editor.type === "add-fill" ? editor.vehicleId : existing?.vehicleId;
    if (!vehicleId) throw new Error("This entry no longer exists.");
    /* Carry the ledger link through: encodeVehicleFillUpdate sends
       `expenseId ?? null`, so omitting it here reads as an explicit unlink and
       silently re-enables Log — letting the same fill be logged twice. */
    const payload = {
      vehicleId,
      ...draft,
      ...(existing?.expenseId ? { expenseId: existing.expenseId } : {}),
    };
    const saved = await onSaveFill(existing ? { id: existing.id, ...payload } : payload);
    setFillList((prev) =>
      existing ? prev.map((f) => (f.id === saved.id ? saved : f)) : [...prev, saved],
    );
    setEditor(null);
    toast(`${sentenceCase(selectedMeta.fillNoun)} ${existing ? "updated" : "added"}`);
  };

  /* Delete handlers also let failures propagate: ConfirmDialog shows them inline. */
  const removeVehicle = async (vehicleId: string) => {
    setDeletingId(vehicleId);
    try {
      await onDeleteVehicle(vehicleId);
      setVehicleList((prev) => prev.filter((v) => v.id !== vehicleId));
      setFillList((prev) => prev.filter((f) => f.vehicleId !== vehicleId));
      setEditor(null);
      toast("Vehicle deleted");
    } finally {
      setDeletingId(null);
    }
  };

  const removeFill = async (fillId: string) => {
    setDeletingId(fillId);
    try {
      await onDeleteFill(fillId);
      setFillList((prev) => prev.filter((f) => f.id !== fillId));
      setEditor(null);
      toast(`${sentenceCase(selectedMeta.fillNoun)} deleted`);
    } finally {
      setDeletingId(null);
    }
  };

  const openAddVehicle = () => setEditor({ type: "add-vehicle" });
  const openEditVehicle = (vehicle: Vehicle) =>
    setEditor({ type: "edit-vehicle", vehicleId: vehicle.id });
  const openAddFill = (vehicleId: string) => setEditor({ type: "add-fill", vehicleId });
  const openEditFill = (fill: FuelFill) => setEditor({ type: "edit-fill", fillId: fill.id });

  useImperativeHandle(ref, () => ({
    select: setSelectedId,
    openAddFillFor: (id: string) => {
      setSelectedId(id);
      openAddFill(id);
    },
  }));

  const viewRef = useRef<HTMLDivElement>(null);
  useEnter(viewRef);

  if (!vehicleList.length && !editor) {
    return (
      <div ref={viewRef} className="view">
        <EmptyState
          title="No Vehicles Yet"
          sub="Add a car, EV, bike, or van to start tracking fuel or charging costs."
        />
        <div className="todo-empty-action">
          <button className="primary-btn" type="button" onClick={openAddVehicle}>
            <Icon name="plus" size={15} /> Add Vehicle
          </button>
        </div>
        {renderEditor()}
      </div>
    );
  }

  function renderEditor() {
    if (!editor) return null;

    if (editor.type === "add-vehicle" || editor.type === "edit-vehicle") {
      const vehicle =
        editor.type === "edit-vehicle"
          ? vehicleList.find((v) => v.id === editor.vehicleId)
          : undefined;
      if (editor.type === "edit-vehicle" && !vehicle) return null;
      return (
        <VehicleEditor
          initial={vehicle}
          deleting={!!vehicle && deletingId === vehicle.id}
          onSave={saveVehicle}
          onDelete={() => vehicle && setConfirmDelete({ type: "vehicle", id: vehicle.id })}
          onClose={() => setEditor(null)}
        />
      );
    }

    const fill =
      editor.type === "edit-fill" ? fillList.find((f) => f.id === editor.fillId) : undefined;
    if (editor.type === "edit-fill" && !fill) return null;
    return (
      <FillEditor
        initial={fill}
        meta={selectedMeta}
        deleting={!!fill && deletingId === fill.id}
        onSave={saveFill}
        onDelete={() => fill && setConfirmDelete({ type: "fill", id: fill.id })}
        onClose={() => setEditor(null)}
      />
    );
  }

  return (
    <div ref={viewRef} className="view">
      <div className="todo-toolbar" data-tour="tour-vehicles-toolbar">
        <button className="primary-btn" type="button" onClick={openAddVehicle}>
          <Icon name="plus" size={15} /> Add Vehicle
        </button>
      </div>

      {selectedVehicle ? (
        <section className="panel vehicles-fuel-insights" data-tour="tour-vehicles-insights">
          <div className="panel-head">
            <h2>Fuel Insights</h2>
            <p className="panel-sub">
              {selectedMeta.mode === "power"
                ? "Charging behaviour and cost, generated from this vehicle's history."
                : "Fuel behaviour and cost, generated from this vehicle's history."}
            </p>
          </div>
          {assessment.status === "insufficient" ? (
            <div className="profile-locked">
              <div className="profile-locked-mark" aria-hidden="true">
                ◌
              </div>
              <div className="profile-locked-copy">
                <p className="profile-locked-title">
                  Insights unlock after {FUEL_MIN_FILLS} {selectedMeta.fillNoun}s
                </p>
                <p className="profile-locked-sub">
                  {assessment.fillsHave} of {assessment.fillsNeeded} logged so far.
                </p>
              </div>
              <div
                className="profile-progress"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={assessment.fillsNeeded}
                aria-valuenow={assessment.fillsHave}
                aria-label={`${selectedMeta.label} Fuel Insights Unlock Progress`}
              >
                <div
                  className="profile-progress-fill"
                  style={{ width: `${(assessment.fillsHave / assessment.fillsNeeded) * 100}%` }}
                />
              </div>
            </div>
          ) : (
            <InsightFeed
              insights={insights}
              emptyLabel="Nothing stands out for this vehicle right now."
            />
          )}
        </section>
      ) : null}

      <div className="capital-grid" data-tour="tour-vehicles-grid">
        {vehicleList.map((vehicle) => {
          const meta = VEHICLE_TYPES[vehicle.type];
          const vFills = fillsFor(vehicle.id);
          const vAssessment = assessVehicleFuel(vFills);
          const active = vehicle.id === selectedId;

          return (
            <div
              key={vehicle.id}
              className={"capital-card" + (active ? " is-selected" : "")}
              onClick={() => setSelectedId(vehicle.id)}
            >
              <div className="capital-card-head">
                <span className="capital-card-glyph">{meta.glyph}</span>
                <div className="capital-card-title">
                  <h3>{vehicle.name}</h3>
                  <span className="capital-tag">{vehicle.model || meta.label}</span>
                </div>
                <div className="capital-card-actions">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      openEditVehicle(vehicle);
                    }}
                    aria-label="Edit Vehicle"
                  >
                    <Icon name="edit" size={15} />
                  </button>
                  <button
                    type="button"
                    className="danger"
                    disabled={!!deletingId}
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDelete({ type: "vehicle", id: vehicle.id });
                    }}
                    aria-label={deletingId === vehicle.id ? "Deleting…" : "Delete Vehicle"}
                  >
                    <Icon name="trash" size={15} />
                  </button>
                </div>
              </div>
              <div className="capital-card-stats">
                {vAssessment.status === "ready" ? (
                  <>
                    <ReadableValue as="div" className="capital-total">
                      {vAssessment.metrics.consumptionPer100 != null
                        ? `${vAssessment.metrics.consumptionPer100.toFixed(1)} ${meta.efficiencyLabel}`
                        : "Add another full " + meta.fillNoun}
                    </ReadableValue>
                    <div className="capital-paid">
                      {vFills.length} {meta.fillNoun}s logged
                    </div>
                  </>
                ) : (
                  <div className="capital-paid">
                    {vAssessment.fillsHave} of {vAssessment.fillsNeeded} {meta.fillNoun}s to unlock
                    insights
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {selectedVehicle ? (
        <section className="panel" data-tour="tour-vehicles-log">
          <div className="panel-head">
            <h2>
              {selectedVehicle.name} — {sentenceCase(selectedMeta.fillNoun)} Log
            </h2>
          </div>
          {selectedFills.length ? (
            <div className="capital-item-list">
              {selectedFills.map((fill) => (
                <div key={fill.id} className="capital-item-row">
                  <span className="capital-item-name">
                    {dayLabel(fill.date)} — {fill.quantity.toFixed(1)} {selectedMeta.unit}
                    {fill.partial ? " (partial)" : ""}
                    {fill.odometer != null ? ` · ${fill.odometer.toLocaleString()} km` : ""}
                    {fill.station ? ` · ${fill.station}` : ""}
                  </span>
                  <button
                    type="button"
                    className="capital-item-cost"
                    disabled={!!deletingId}
                    onClick={() => openEditFill(fill)}
                  >
                    {money(fill.price)}
                  </button>
                  {!fill.expenseId || !linkedExpenseIds.has(fill.expenseId) ? (
                    <button
                      type="button"
                      className="ghost-btn sm"
                      onClick={() => onLogFill(selectedVehicle, fill)}
                    >
                      Log
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="capital-item-remove"
                    disabled={!!deletingId}
                    onClick={() => setConfirmDelete({ type: "fill", id: fill.id })}
                    aria-label={
                      deletingId === fill.id ? "Removing…" : "Remove " + selectedMeta.fillNoun
                    }
                  >
                    <Icon name="close" size={13} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="panel-sub">No {selectedMeta.fillNoun}s logged yet.</p>
          )}
        </section>
      ) : null}

      {renderEditor()}

      {confirmDelete ? (
        <ConfirmDialog
          title={
            confirmDelete.type === "vehicle"
              ? "Delete Vehicle"
              : `Delete ${titleCase(selectedMeta.fillNoun)}`
          }
          message={
            confirmDelete.type === "vehicle"
              ? (() => {
                  const vehicle = vehicleList.find((v) => v.id === confirmDelete.id);
                  const count = fillsFor(confirmDelete.id).length;
                  const noun = VEHICLE_TYPES[vehicle?.type ?? "car"].fillNoun;
                  return count
                    ? `Delete "${vehicle?.name ?? ""}" and ${count === 1 ? `its 1 logged ${noun}` : `all ${count} logged ${noun}s`}? This cannot be undone.`
                    : `Delete "${vehicle?.name ?? ""}"? This cannot be undone.`;
                })()
              : (() => {
                  const fill = fillList.find((f) => f.id === confirmDelete.id);
                  return `Delete this ${selectedMeta.fillNoun}${fill ? ` from ${dayLabel(fill.date)}` : ""}? This cannot be undone.`;
                })()
          }
          requireText={
            confirmDelete.type === "vehicle" && fillsFor(confirmDelete.id).length > 0
              ? vehicleList.find((v) => v.id === confirmDelete.id)?.name
              : undefined
          }
          onCancel={() => setConfirmDelete(null)}
          onConfirm={async () => {
            if (confirmDelete.type === "vehicle") await removeVehicle(confirmDelete.id);
            else await removeFill(confirmDelete.id);
            setConfirmDelete(null);
          }}
        />
      ) : null}
    </div>
  );
});
