"use client";

import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { niceMax, type Entity } from "@/lib/work";

export type BarMetric = { key: string; label: string; color: string };

/* A grouped bar chart: one group per profile or person along the x-axis,
   one bar per amount in each group.

   Drawn at the container's real width rather than scaled from a fixed
   viewBox, so text stays 11px however many groups there are. When the
   groups would be too narrow to read, the chart grows wider than its card
   and scrolls sideways instead of squeezing.

   Identity is never colour alone: there is a legend, the hover readout
   names every amount in the group, and the same numbers are in a table
   underneath. */
const MIN_GROUP = 64;
const H = 260;
const pad = { l: 40, r: 12, t: 14, b: 40 };

export default function WorkBars({
  entities,
  metrics,
  values,
  label,
}: {
  entities: Entity[];
  metrics: BarMetric[];
  values: Map<number, Record<string, number>>;
  label: string;
}) {
  const wrap = useRef<HTMLDivElement | null>(null);
  const [at, setAt] = useState<number | null>(null);

  /* The card's width, read from the DOM. Null on the server and on the
     browser's first pass, which then render the same empty frame — so the
     two agree, and the chart appears once it can be measured. */
  const subscribe = useCallback((onChange: () => void) => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver === "undefined") return () => {};
    const ro = new ResizeObserver(onChange);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const width = useSyncExternalStore(
    subscribe,
    () => (wrap.current ? Math.round(wrap.current.clientWidth) : null),
    () => null,
  );

  const n = entities.length;
  const valueOf = (id: number, key: string) => values.get(id)?.[key] ?? 0;
  const totalOf = (id: number) => metrics.reduce((a, m) => a + valueOf(id, m.key), 0);
  const top = niceMax(Math.max(0, ...entities.flatMap((e) => metrics.map((m) => valueOf(e.id, m.key)))));

  const W = width === null ? 0 : Math.max(width, pad.l + pad.r + n * MIN_GROUP);
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const groupW = n ? innerW / n : innerW;
  // Bars sit side by side with a 2px gap, and never grow fat when there are few groups.
  const barW = Math.max(6, Math.min(22, (groupW - 16 - 2 * (metrics.length - 1)) / metrics.length));
  const clusterW = metrics.length * barW + 2 * (metrics.length - 1);
  const y = (v: number) => pad.t + innerH - (v / top) * innerH;
  const base = y(0);
  const ticks = [0, top / 2, top];

  // About 6.3px per character at 11px: cut names that would run into the next group.
  const maxChars = Math.max(4, Math.floor((groupW - 6) / 6.3));
  const short = (s: string) => (s.length > maxChars ? `${s.slice(0, maxChars - 1)}…` : s);

  /* A bar with its top corners rounded and its foot square on the baseline. */
  const bar = (x0: number, v: number) => {
    const y0 = y(v);
    const h = base - y0;
    const r = Math.min(4, h, barW / 2);
    return `M${x0},${base} V${y0 + r} Q${x0},${y0} ${x0 + r},${y0} H${x0 + barW - r} Q${x0 + barW},${y0} ${x0 + barW},${y0 + r} V${base} Z`;
  };

  return (
    <div className="workbars">
      <div className="workbars-scroll" ref={wrap}>
        {width !== null && n > 0 && (
          <div className="workbars-plot" style={{ width: W }}>
            <svg
              width={W}
              height={H}
              role="img"
              aria-label={label}
              tabIndex={0}
              className="workbars-svg"
              onPointerLeave={() => setAt(null)}
              onBlur={() => setAt(null)}
              onKeyDown={(e) => {
                // Arrows walk the groups, so the readout works without a pointer.
                if (e.key === "ArrowRight") setAt((i) => Math.min(n - 1, (i ?? -1) + 1));
                if (e.key === "ArrowLeft") setAt((i) => Math.max(0, (i ?? n) - 1));
                if (e.key === "Escape") setAt(null);
              }}
            >
              {ticks.map((t) => (
                <g key={t}>
                  <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="linechart-grid" />
                  <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" className="linechart-label">
                    {t}
                  </text>
                </g>
              ))}

              {entities.map((e, i) => {
                const gx = pad.l + i * groupW;
                const cx = gx + (groupW - clusterW) / 2;
                return (
                  <g key={e.id}>
                    {at === i && <rect x={gx + 2} y={pad.t} width={groupW - 4} height={innerH} className="workbars-hover" />}
                    {metrics.map((m, mi) => {
                      const v = valueOf(e.id, m.key);
                      return v > 0 ? <path key={m.key} d={bar(cx + mi * (barW + 2), v)} fill={m.color} /> : null;
                    })}
                    <text x={gx + groupW / 2} y={H - pad.b + 18} textAnchor="middle" className="linechart-label">
                      {short(e.name)}
                    </text>
                    {/* The whole column is the hit target, not the bars: a group of
                        zeros has no bar to point at but still has a readout. */}
                    <rect
                      x={gx}
                      y={pad.t}
                      width={groupW}
                      height={H - pad.t}
                      fill="transparent"
                      onPointerEnter={() => setAt(i)}
                      onPointerMove={() => at !== i && setAt(i)}
                    />
                  </g>
                );
              })}
            </svg>

            {at !== null && entities[at] && (
              <div
                className="workchart-tip"
                // Beside its group, flipped to the left past the middle so it stays on the plot.
                style={
                  pad.l + (at + 0.5) * groupW > W * 0.6
                    ? { right: W - (pad.l + at * groupW) + 6 }
                    : { left: pad.l + (at + 1) * groupW + 6 }
                }
              >
                <div className="workchart-tip-head">{entities[at].name}</div>
                {metrics.map((m) => (
                  <div className="workchart-tip-row" key={m.key}>
                    <span className="workchart-key" style={{ background: m.color }} />
                    <strong>{valueOf(entities[at].id, m.key)}</strong>
                    <span>{m.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {width === null && <div style={{ height: H }} />}
      </div>

      <ul className="linechart-legend">
        {metrics.map((m) => (
          <li key={m.key}>
            <span className="workbars-swatch" style={{ background: m.color }} />
            <span>{m.label}</span>
          </li>
        ))}
      </ul>

      <details className="workchart-table">
        <summary>Show as table</summary>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                {metrics.map((m) => (
                  <th key={m.key} className="num">
                    {m.label}
                  </th>
                ))}
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {entities.map((e) => (
                <tr key={e.id}>
                  <td>{e.name}</td>
                  {metrics.map((m) => (
                    <td key={m.key} className="num">
                      {valueOf(e.id, m.key)}
                    </td>
                  ))}
                  <td className="num">
                    <strong>{totalOf(e.id)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
