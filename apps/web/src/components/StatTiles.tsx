import type { ReactNode } from "react";
import type { Status, WeekData } from "@/lib/types";

type Tone = "accent" | "ok" | "warn" | "danger" | "violet";

type IconName = "points" | "target" | "clock" | "check" | "pause" | "split";

function TileIcon({ name }: { name: IconName }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };
  switch (name) {
    case "points":
      return (
        <svg {...common}>
          <path d="M4 19V10M10 19V5M16 19v-6M21 19H3" />
        </svg>
      );
    case "target":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
          <circle cx="12" cy="12" r="3.4" />
        </svg>
      );
    case "clock":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7.5V12l3 1.8" />
        </svg>
      );
    case "check":
      return (
        <svg {...common}>
          <path d="M20 6.5 9.5 17 4 11.5" />
        </svg>
      );
    case "pause":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M10 9v6M14 9v6" />
        </svg>
      );
    case "split":
      return (
        <svg {...common}>
          <path d="M3 12h5M16 12h5M10.5 8l3 8" />
        </svg>
      );
  }
}

export function Tile({
  label,
  value,
  sub,
  tone = "accent",
  icon,
  meter,
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  tone?: Tone;
  icon: IconName;
  /** 0–100: draws a meter under the value. */
  meter?: number;
}) {
  return (
    <div className="tile">
      <span className={`tile-icon tone-${tone}`}>
        <TileIcon name={icon} />
      </span>
      <div className="tile-body">
        <span className="tile-label">{label}</span>
        <span className="tile-value">
          {value}
          {sub ? <span className="tile-sub">{sub}</span> : null}
        </span>
        {meter !== undefined && (
          <span className="tile-meter" aria-hidden>
            <span style={{ width: `${Math.max(0, Math.min(100, meter))}%` }} />
          </span>
        )}
      </div>
    </div>
  );
}

const statusCopy: Record<Status, { text: string; tone: Tone }> = {
  draft: { text: "In progress", tone: "accent" },
  submitted: { text: "In review", tone: "warn" },
  approved: { text: "Approved", tone: "ok" },
  returned: { text: "Returned", tone: "danger" },
};

// Everything here comes from the /week response the dashboard already loads.
export default function StatTiles({ data }: { data: WeekData }) {
  const pct = data.score.achievement_pct;
  const status = statusCopy[data.status];
  const targetTone: Tone = pct === null ? "accent" : pct >= 100 ? "ok" : pct >= 70 ? "warn" : "danger";

  return (
    <div className="tiles">
      <Tile label="Points this week" value={data.score.total} icon="points" tone="accent" />
      <Tile
        label="Achievement"
        value={pct === null ? "—" : `${pct}%`}
        sub={pct === null ? "no targets set" : undefined}
        icon="target"
        tone={targetTone}
      />
      <Tile label="Tracked time" value={`${data.time_hours} h`} icon="clock" tone="violet" />
      <Tile label="Week status" value={status.text} icon="check" tone={status.tone} />
    </div>
  );
}
