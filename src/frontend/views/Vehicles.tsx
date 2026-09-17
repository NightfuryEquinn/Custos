import { DatePicker } from "@/frontend/components/DateTimePicker";
import { ConfirmDialog, EmptyState, Icon, InsightFeed } from "@/frontend/components/ui";
import { dayLabel, fmtMoney } from "@/frontend/lib/data";
import { useEnter, useModalMotion } from "@/frontend/lib/animate";
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
  openAddFillForSelected: () => void;
};

type EditorMode =
  | { type: "add-vehicle" }
  | { type: "edit-vehicle"; vehicleId: string }
  | { type: "add-fill"; vehicleId: string }
  | { type: "edit-fill"; fillId: string }
  | null;

const VEHICLE_TYPE_LIST: VehicleType[] = ["car", "ev", "bike", "van"];

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /* `busy` state can't stop two clicks landing in the same task from both
     calling persistVehicle/persistFill before either's setBusy(true)
     commits — a ref flips synchronously, so the second call always sees it. */
  const persistingRef = useRef(false);
  const [removingFillId, setRemovingFillId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<
    { type: "vehicle"; id: string } | { type: "fill"; id: string } | null
  >(null);
  const vehicleScrimRef = useRef<HTMLDivElement>(null);
  const vehiclePanelRef = useRef<HTMLDivElement>(null);
  const fillScrimRef = useRef<HTMLDivElement>(null);
  const fillPanelRef = useRef<HTMLDivElement>(null);
  const vehicleEditorOpen =
    !!editor && (editor.type === "add-vehicle" || editor.type === "edit-vehicle");
  const fillEditorOpen = !!editor && (editor.type === "add-fill" || editor.type === "edit-fill");
  const { requestClose: requestCloseVehicle } = useModalMotion(vehicleScrimRef, vehiclePanelRef, {
    variant: "center",
    active: vehicleEditorOpen,
  });
  const { requestClose: requestCloseFill } = useModalMotion(fillScrimRef, fillPanelRef, {
    variant: "center",
    active: fillEditorOpen,
  });
  const closeEditor = () => requestCloseVehicle(() => setEditor(null));
  const closeFillEditor = () => requestCloseFill(() => setEditor(null));

  const [name, setName] = useState("");
  const [model, setModel] = useState("");
  const [type, setType] = useState<VehicleType>("car");
  const [plate, setPlate] = useState("");
  const [odometerStart, setOdometerStart] = useState("");
  const [tankCapacity, setTankCapacity] = useState("");

  const [fillDate, setFillDate] = useState("");
  const [fillPrice, setFillPrice] = useState("");
  const [fillQuantity, setFillQuantity] = useState("");
  const [fillOdometer, setFillOdometer] = useState("");
  const [fillStation, setFillStation] = useState("");
  const [fillPartial, setFillPartial] = useState(false);

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

  const persistVehicle = async (data: Omit<Vehicle, "id" | "createdAt"> & { id?: string }) => {
    if (persistingRef.current) return undefined;
    persistingRef.current = true;
    setBusy(true);
    setError("");
    try {
      const saved = await onSaveVehicle(data);
      setVehicleList((prev) =>
        data.id ? prev.map((v) => (v.id === saved.id ? saved : v)) : [...prev, saved],
      );
      return saved;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save vehicle");
      throw err;
    } finally {
      persistingRef.current = false;
      setBusy(false);
    }
  };

  const persistFill = async (data: Omit<FuelFill, "id"> & { id?: string }) => {
    if (persistingRef.current) return undefined;
    persistingRef.current = true;
    setBusy(true);
    setError("");
    try {
      const saved = await onSaveFill(data);
      setFillList((prev) =>
        data.id ? prev.map((f) => (f.id === saved.id ? saved : f)) : [...prev, saved],
      );
      return saved;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save fill");
      throw err;
    } finally {
      persistingRef.current = false;
      setBusy(false);
    }
  };

  const openAddVehicle = () => {
    setEditor({ type: "add-vehicle" });
    setName("");
    setModel("");
    setType("car");
    setPlate("");
    setOdometerStart("");
    setTankCapacity("");
    setError("");
  };

  const openEditVehicle = (vehicle: Vehicle) => {
    setEditor({ type: "edit-vehicle", vehicleId: vehicle.id });
    setName(vehicle.name);
    setModel(vehicle.model);
    setType(vehicle.type);
    setPlate(vehicle.plate ?? "");
    setOdometerStart(vehicle.odometerStart != null ? String(vehicle.odometerStart) : "");
    setTankCapacity(vehicle.tankCapacity != null ? String(vehicle.tankCapacity) : "");
    setError("");
  };

  const submitVehicleEditor = async () => {
    if (
      !name.trim() ||
      !editor ||
      (editor.type !== "add-vehicle" && editor.type !== "edit-vehicle")
    )
      return;
    const meta = VEHICLE_TYPES[type];
    const payload = {
      name: name.trim(),
      model: model.trim(),
      type,
      plate: plate.trim() || undefined,
      glyph: meta.glyph,
      odometerStart: Number(odometerStart) || undefined,
      tankCapacity: Number(tankCapacity) || undefined,
    };

    const saved =
      editor.type === "add-vehicle"
        ? await persistVehicle(payload)
        : await persistVehicle({ id: editor.vehicleId, ...payload });

    if (saved) {
      setSelectedId(saved.id);
      setEditor(null);
    }
  };

  const removeVehicle = async (vehicleId: string) => {
    setBusy(true);
    setError("");
    try {
      await onDeleteVehicle(vehicleId);
      setVehicleList((prev) => prev.filter((v) => v.id !== vehicleId));
      setFillList((prev) => prev.filter((f) => f.vehicleId !== vehicleId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete vehicle");
    } finally {
      setBusy(false);
    }
  };

  const openAddFill = (vehicleId: string) => {
    setEditor({ type: "add-fill", vehicleId });
    setFillDate("");
    setFillPrice("");
    setFillQuantity("");
    setFillOdometer("");
    setFillStation("");
    setFillPartial(false);
    setError("");
  };

  useImperativeHandle(ref, () => ({
    select: setSelectedId,
    openAddFillFor: (id: string) => {
      setSelectedId(id);
      openAddFill(id);
    },
    openAddFillForSelected: () => {
      if (selectedVehicle) openAddFill(selectedVehicle.id);
    },
  }));

  const openEditFill = (fill: FuelFill) => {
    setEditor({ type: "edit-fill", fillId: fill.id });
    setFillDate(fill.date);
    setFillPrice(String(fill.price));
    setFillQuantity(String(fill.quantity));
    setFillOdometer(fill.odometer != null ? String(fill.odometer) : "");
    setFillStation(fill.station);
    setFillPartial(fill.partial);
    setError("");
  };

  const submitFillEditor = async () => {
    if (!editor || (editor.type !== "add-fill" && editor.type !== "edit-fill")) return;
    if (!fillDate || !(Number(fillPrice) > 0) || !(Number(fillQuantity) > 0)) {
      setError("Date, price, and quantity are required");
      return;
    }

    const vehicleId =
      editor.type === "add-fill"
        ? editor.vehicleId
        : fillList.find((f) => f.id === editor.fillId)?.vehicleId;
    if (!vehicleId) return;

    /* Carry the ledger link through: encodeVehicleFillUpdate sends
       `expenseId ?? null`, so omitting it here reads as an explicit unlink and
       silently re-enables Log — letting the same fill be logged twice. */
    const existingFill =
      editor.type === "edit-fill" ? fillList.find((f) => f.id === editor.fillId) : undefined;
    const payload = {
      vehicleId,
      date: fillDate,
      price: Number(fillPrice),
      quantity: Number(fillQuantity),
      odometer: fillOdometer ? Number(fillOdometer) : undefined,
      station: fillStation.trim(),
      partial: fillPartial,
      ...(existingFill?.expenseId ? { expenseId: existingFill.expenseId } : {}),
    };

    const saved =
      editor.type === "add-fill"
        ? await persistFill(payload)
        : await persistFill({ id: editor.fillId, ...payload });

    if (saved) setEditor(null);
  };

  const removeFill = async (fillId: string) => {
    if (busy || removingFillId) return;
    setRemovingFillId(fillId);
    try {
      await onDeleteFill(fillId);
      setFillList((prev) => prev.filter((f) => f.id !== fillId));
    } finally {
      setRemovingFillId(null);
    }
  };
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
      return createPortal(
        <div
          ref={vehicleScrimRef}
          className="modal-scrim center"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !busy) closeEditor();
          }}
        >
          <div ref={vehiclePanelRef} className="modal sm" role="dialog" aria-modal="true">
            <div className="modal-head">
              <h3>{editor.type === "add-vehicle" ? "Add Vehicle" : "Edit Vehicle"}</h3>
              <button
                className="icon-btn"
                type="button"
                onClick={closeEditor}
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
                  placeholder="0"
                />

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
                  placeholder="0"
                />

                {error ? <p className="auth-error">{error}</p> : null}

                <div className="wallet-form-actions">
                  <button
                    className="ghost-btn full"
                    type="button"
                    onClick={closeEditor}
                    disabled={busy}
                  >
                    Cancel
                  </button>
                  <button
                    className="primary-btn full"
                    type="button"
                    disabled={busy || !name.trim()}
                    onClick={() => void submitVehicleEditor()}
                  >
                    {busy ? "Saving…" : "Save"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      );
    }

    const meta = VEHICLE_TYPES[selectedVehicle?.type ?? "car"];
    return createPortal(
      <div
        ref={fillScrimRef}
        className="modal-scrim center"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget && !busy) closeFillEditor();
        }}
      >
        <div ref={fillPanelRef} className="modal sm" role="dialog" aria-modal="true">
          <div className="modal-head">
            <h3>{editor.type === "add-fill" ? meta.fillVerb : `Edit ${meta.fillNoun}`}</h3>
            <button
              className="icon-btn"
              type="button"
              onClick={closeFillEditor}
              aria-label="Close"
              disabled={busy}
            >
              <Icon name="close" size={18} />
            </button>
          </div>
          <div className="modal-body modal-scroll">
            <div className="dm-sec">
              <label className="fld-label">Date</label>
              <DatePicker value={fillDate} onChange={setFillDate} className="wallet-field" />

              <label className="fld-label" htmlFor="fill-price">
                Total price
              </label>
              <input
                id="fill-price"
                className="text-in wallet-field"
                type="text"
                inputMode="decimal"
                value={fillPrice}
                onChange={(e) => setFillPrice(e.target.value)}
                placeholder="0"
              />

              <label className="fld-label" htmlFor="fill-quantity">
                {meta.unitLong[0]!.toUpperCase() + meta.unitLong.slice(1)}s ({meta.unit})
              </label>
              <input
                id="fill-quantity"
                className="text-in wallet-field"
                type="text"
                inputMode="decimal"
                value={fillQuantity}
                onChange={(e) => setFillQuantity(e.target.value)}
                placeholder="0"
              />

              <label className="fld-label" htmlFor="fill-odometer">
                Odometer, km (optional)
              </label>
              <input
                id="fill-odometer"
                className="text-in wallet-field"
                type="text"
                inputMode="decimal"
                value={fillOdometer}
                onChange={(e) => setFillOdometer(e.target.value)}
                placeholder="0"
              />

              <label className="fld-label" htmlFor="fill-station">
                {meta.stationNoun[0]!.toUpperCase() + meta.stationNoun.slice(1)} (optional)
              </label>
              <input
                id="fill-station"
                className="text-in wallet-field"
                value={fillStation}
                onChange={(e) => setFillStation(e.target.value)}
              />

              <label className="toggle-line tight">
                <input
                  type="checkbox"
                  checked={fillPartial}
                  onChange={(e) => setFillPartial(e.target.checked)}
                />
                Partial {meta.fillNoun} — did not fill to full
              </label>

              {error ? <p className="auth-error">{error}</p> : null}

              <div className="wallet-form-actions">
                <button
                  className="ghost-btn full"
                  type="button"
                  onClick={closeFillEditor}
                  disabled={busy}
                >
                  Cancel
                </button>
                <button
                  className="primary-btn full"
                  type="button"
                  disabled={busy}
                  onClick={() => void submitFillEditor()}
                >
                  {busy ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  return (
    <div ref={viewRef} className="view">
      <div className="todo-toolbar" data-tour="tour-vehicles-toolbar">
        <button className="primary-btn" type="button" onClick={openAddVehicle}>
          <Icon name="plus" size={15} /> Add Vehicle
        </button>
      </div>

      {error ? <p className="auth-error">{error}</p> : null}

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
                    disabled={busy}
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDelete({ type: "vehicle", id: vehicle.id });
                    }}
                    aria-label={busy ? "Deleting…" : "Delete Vehicle"}
                  >
                    <Icon name="trash" size={15} />
                  </button>
                </div>
              </div>
              <div className="capital-card-stats">
                {vAssessment.status === "ready" ? (
                  <>
                    <div className="capital-total">
                      {vAssessment.metrics.consumptionPer100 != null
                        ? `${vAssessment.metrics.consumptionPer100.toFixed(1)} ${meta.efficiencyLabel}`
                        : "Add another full " + meta.fillNoun}
                    </div>
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
              {selectedVehicle.name} —{" "}
              {selectedMeta.fillNoun[0]!.toUpperCase() + selectedMeta.fillNoun.slice(1)} Log
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
                    disabled={busy}
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
                    disabled={busy || removingFillId === fill.id}
                    onClick={() => setConfirmDelete({ type: "fill", id: fill.id })}
                    aria-label={removingFillId === fill.id ? "Removing…" : "Remove fill"}
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
          title={confirmDelete.type === "vehicle" ? "Delete Vehicle" : "Remove Fill"}
          message={
            confirmDelete.type === "vehicle"
              ? (() => {
                  const vehicle = vehicleList.find((v) => v.id === confirmDelete.id);
                  const count = fillsFor(confirmDelete.id).length;
                  return `Delete "${vehicle?.name ?? ""}" and all ${count} logged fills? This cannot be undone.`;
                })()
              : (() => {
                  const fill = fillList.find((f) => f.id === confirmDelete.id);
                  return `Remove this fill${fill ? ` from ${dayLabel(fill.date)}` : ""}? This cannot be undone.`;
                })()
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
