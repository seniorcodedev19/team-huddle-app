"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { clock } from "@/lib/timeReport";

const DAY = 86_400;

/* How many people are active at each time of day on a typical day: each
   person's share of every 15 minutes, averaged over the days they were
   active, summed across people. Times are each person's local time. */
export default function ActiveByTimeChart({ values }: { values: number[] }) {
  const slot = DAY / values.length;
  const data = values.map((v, i) => ({ t: i * slot, v }));
  const max = Math.max(1, Math.ceil(Math.max(...values)));

  return (
    <div className="tr-chart" role="img" aria-label="Average number of people active at each time of day">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--line)" />
          <XAxis
            dataKey="t"
            type="number"
            domain={[0, DAY]}
            ticks={Array.from({ length: 12 }, (_, i) => i * 7200)}
            tickFormatter={(t: number) => clock(t)}
            axisLine={false}
            tickLine={false}
            minTickGap={16}
            tick={{ fill: "var(--muted)", fontSize: 12 }}
          />
          <YAxis
            domain={[0, max]}
            allowDecimals={false}
            axisLine={false}
            tickLine={false}
            width={28}
            tick={{ fill: "var(--muted)", fontSize: 12 }}
          />
          <Tooltip
            cursor={{ stroke: "var(--line-strong)", strokeWidth: 1 }}
            content={({ active, payload }) => {
              const p = payload?.[0]?.payload as { t: number; v: number } | undefined;
              if (!active || !p) return null;
              return (
                <div className="tr-tip">
                  <strong>{p.v.toLocaleString("en-US", { maximumFractionDigits: 1 })}</strong>
                  <span>
                    {p.v === 1 ? "person" : "people"} active, {clock(p.t)}–{clock(p.t + slot)}
                  </span>
                </div>
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="v"
            stroke="var(--s0)"
            strokeWidth={2}
            fill="var(--s0)"
            fillOpacity={0.1}
            activeDot={{ r: 4, fill: "var(--s0)", stroke: "var(--surface)", strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
