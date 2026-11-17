"use client";

import { useState } from "react";
import { useAction } from "@/lib/client";
import Dropdown from "./Dropdown";
import Switch from "./Switch";
import { isTimeTracking, type FormulaType, type Metric, type Team, type User } from "@/lib/types";

const Err = ({ text }: { text: string | null }) =>
  text ? <div className="msg error" role="alert">{text}</div> : null;

const needsTarget = (t: FormulaType) => t === "ratio" || t === "overtime";

const FORMULA_OPTIONS: { value: FormulaType; label: string }[] = [
  { value: "ratio", label: "Ratio (done ÷ target)" },
  { value: "count", label: "Count (done)" },
  { value: "overtime", label: "Overtime (base + extra bonus)" },
];

function Row({ m, canEdit }: { m: Metric; canEdit: boolean }) {
  const { error, busy, run } = useAction();
  const [name, setName] = useState(m.name);
  const [formula, setFormula] = useState(m.formula_type);
  const [weight, setWeight] = useState(String(m.weight));
  const [target, setTarget] = useState(String(m.target));
  const [overtimeRate, setOvertimeRate] = useState(String(m.overtime_rate ?? 0));
  const [unit, setUnit] = useState(m.unit);
  const [active, setActive] = useState(m.active);
  const dirty =
    name.trim() !== m.name ||
    formula !== m.formula_type ||
    Number(weight) !== Number(m.weight) ||
    Number(target) !== Number(m.target) ||
    Number(overtimeRate) !== Number(m.overtime_rate ?? 0) ||
    unit !== m.unit ||
    active !== m.active;
  return (
    <tr>
      <td>
        <input aria-label="Metric name" value={name} maxLength={80} disabled={!canEdit} onChange={(e) => setName(e.target.value)} />
        <div className="muted" style={{ fontSize: 13 }}>
          {m.team_id === null ? "all teams" : (m.team_name ?? "your team")}
        </div>
      </td>
      <td>
        {isTimeTracking(m) ? (
          <span className="muted">ManicTime active time (built-in)</span>
        ) : (
          <Dropdown<FormulaType>
            ariaLabel={`${name || m.name} formula`}
            value={formula}
            disabled={!canEdit}
            onChange={setFormula}
            options={FORMULA_OPTIONS}
          />
        )}
      </td>
      <td className="n">
        <input type="number" step="any" min={0} aria-label={`${name || m.name} weight`} value={weight} disabled={!canEdit} onChange={(e) => setWeight(e.target.value)} />
      </td>
      <td className="n">
        {formula === "overtime" || isTimeTracking(m) ? (
          <input
            type="number"
            step="any"
            min={0}
            aria-label={`${name || m.name} overtime bonus`}
            value={overtimeRate}
            disabled={!canEdit}
            onChange={(e) => setOvertimeRate(e.target.value)}
          />
        ) : (
          <span className="muted">–</span>
        )}
      </td>
      <td className="n">
        {needsTarget(formula) ? (
          <input type="number" step="any" min={0} aria-label={`${name || m.name} weekly target`} value={target} disabled={!canEdit} onChange={(e) => setTarget(e.target.value)} />
        ) : (
          <span className="muted">–</span>
        )}
      </td>
      <td>
        <input type="text" aria-label={`${name || m.name} unit`} value={unit} maxLength={24} disabled={!canEdit} onChange={(e) => setUnit(e.target.value)} style={{ width: 90 }} />
      </td>
      <td>
        <Switch
          label={`${name || m.name} is active`}
          checked={isTimeTracking(m) ? true : active}
          disabled={!canEdit || isTimeTracking(m)}
          onChange={setActive}
        />
      </td>
      <td>
        {canEdit && (
          <button
            className="btn secondary"
            disabled={!dirty || !name.trim() || busy || (isTimeTracking(m) && Number(target) <= 0)}
            onClick={() =>
              run("PATCH", `/metrics/${m.id}`, {
                name: name.trim(),
                ...(isTimeTracking(m) ? {} : { formula_type: formula }),
                weight: Number(weight),
                target: needsTarget(formula) ? Number(target) : 0,
                overtime_rate: formula === "overtime" || isTimeTracking(m) ? Number(overtimeRate) : 0,
                unit,
                active,
              })
            }
          >
            Save
          </button>
        )}
        <Err text={error} />
      </td>
    </tr>
  );
}

export default function MetricsManager({ me, metrics, teams }: { me: User; metrics: Metric[]; teams: Team[] }) {
  const { error, busy, run } = useAction();
  const [f, setF] = useState({
    name: "",
    formula_type: "ratio" as FormulaType,
    weight: "20",
    target: "5",
    overtime_rate: "1",
    unit: "",
    team_id: "",
  });

  return (
    <div className="panel">
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Metric</th>
              <th>Formula</th>
              <th className="n">Weight (base)</th>
              <th className="n">Overtime bonus</th>
              <th className="n">Weekly target</th>
              <th>Unit</th>
              <th>Active</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {metrics.map((m) => (
              <Row
                key={`${m.id}-${m.name}-${m.formula_type}-${m.weight}-${m.target}-${m.overtime_rate}-${m.unit}-${m.active}`}
                m={m}
                canEdit={me.role === "admin"}
              />
            ))}
          </tbody>
        </table>
      </div>

      <h2 style={{ marginTop: 24 }}>Add a metric</h2>
      <p className="sub" style={{ marginTop: -4 }}>
        Time Tracking is built in (hours from the Time page). Other metrics can use ratio, count, or the same overtime formula with a weekly total.
      </p>
      <div className="row">
        <div>
          <label htmlFor="m-name">Name</label>
          <input id="m-name" placeholder="Job apply" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </div>
        <div>
          <label htmlFor="m-type">Formula</label>
          <Dropdown<FormulaType>
            id="m-type"
            ariaLabel="Formula"
            value={f.formula_type}
            onChange={(v) => setF({ ...f, formula_type: v })}
            options={FORMULA_OPTIONS}
          />
        </div>
        <div>
          <label htmlFor="m-weight">Weight (base)</label>
          <input id="m-weight" type="number" step="any" min={0} value={f.weight} onChange={(e) => setF({ ...f, weight: e.target.value })} />
        </div>
        {f.formula_type === "overtime" && (
          <div>
            <label htmlFor="m-bonus">Overtime bonus</label>
            <input
              id="m-bonus"
              type="number"
              step="any"
              min={0}
              value={f.overtime_rate}
              onChange={(e) => setF({ ...f, overtime_rate: e.target.value })}
            />
          </div>
        )}
        {needsTarget(f.formula_type) && (
          <div>
            <label htmlFor="m-target">Weekly target</label>
            <input id="m-target" type="number" step="any" min={0} value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} />
          </div>
        )}
        <div>
          <label htmlFor="m-unit">Unit</label>
          <input id="m-unit" placeholder="items" maxLength={24} value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} style={{ width: 100 }} />
        </div>
        {me.role === "admin" && (
          <div>
            <label htmlFor="m-team">For</label>
            <Dropdown<string>
              id="m-team"
              ariaLabel="For"
              value={f.team_id}
              onChange={(v) => setF({ ...f, team_id: v })}
              options={[
                { value: "", label: "All teams" },
                ...teams.map((t) => ({ value: String(t.id), label: t.name })),
              ]}
            />
          </div>
        )}
        <button
          className="btn"
          disabled={!f.name.trim() || busy}
          onClick={async () => {
            const ok = await run("POST", "/metrics", {
              name: f.name,
              formula_type: f.formula_type,
              weight: Number(f.weight),
              target: needsTarget(f.formula_type) ? Number(f.target) : 0,
              overtime_rate: f.formula_type === "overtime" ? Number(f.overtime_rate) : 0,
              unit: f.unit,
              ...(me.role === "admin" ? { team_id: f.team_id ? Number(f.team_id) : null } : {}),
            });
            if (ok) setF({ ...f, name: "", unit: "" });
          }}
        >
          Add metric
        </button>
      </div>
      <Err text={error} />
    </div>
  );
}
