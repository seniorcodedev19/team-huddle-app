// Leading icon inside an auth form field.
export function FieldIcon({ name }: { name: "mail" | "lock" | "user" }) {
  const common = {
    width: 17,
    height: 17,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };
  if (name === "mail") {
    return (
      <svg {...common}>
        <rect x="2.8" y="5" width="18.4" height="14" rx="3" />
        <path d="m3.5 7.5 7.3 5.1a2 2 0 0 0 2.4 0l7.3-5.1" />
      </svg>
    );
  }
  if (name === "lock") {
    return (
      <svg {...common}>
        <rect x="4.2" y="10.3" width="15.6" height="10.2" rx="3" />
        <path d="M7.8 10.3V7.6a4.2 4.2 0 0 1 8.4 0v2.7" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.8 20a7.2 7.2 0 0 1 14.4 0" />
    </svg>
  );
}

// The Team Huddle mark: three people gathered together.
export function Logo({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="6.4" r="3.1" />
      <circle cx="4.9" cy="9.4" r="2.5" />
      <circle cx="19.1" cy="9.4" r="2.5" />
      <path d="M12 11.2c3.3 0 6 2.3 6 5.2v1.2a.9.9 0 0 1-.9.9H6.9a.9.9 0 0 1-.9-.9v-1.2c0-2.9 2.7-5.2 6-5.2Z" />
      <path d="M4.6 13.3c.5 0 1 .05 1.5.16A7.6 7.6 0 0 0 4.3 18H1.5a.8.8 0 0 1-.8-.8v-.8c0-1.7 1.7-3.1 3.9-3.1Z" opacity="0.72" />
      <path d="M19.4 13.3c2.2 0 3.9 1.4 3.9 3.1v.8a.8.8 0 0 1-.8.8h-2.8a7.6 7.6 0 0 0-1.8-4.54c.49-.11.99-.16 1.5-.16Z" opacity="0.72" />
    </svg>
  );
}

export function Icon({
  name,
  size = 18,
}: {
  name:
    | "dashboard"
    | "team"
    | "time"
    | "calendar"
    | "profile"
    | "admin"
    | "logout"
    | "agent"
    | "metrics"
    | "profiles"
    | "training"
    | "sites"
    | "history";
  size?: number;
}) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };
  switch (name) {
    case "dashboard":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7" height="9" rx="1.5" />
          <rect x="14" y="3" width="7" height="5" rx="1.5" />
          <rect x="14" y="12" width="7" height="9" rx="1.5" />
          <rect x="3" y="16" width="7" height="5" rx="1.5" />
        </svg>
      );
    case "team":
      return (
        <svg {...common}>
          <circle cx="9" cy="8" r="3" />
          <circle cx="17" cy="9" r="2.5" />
          <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
          <path d="M14 19a4.5 4.5 0 0 1 6.5-4" />
        </svg>
      );
    case "time":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7.5V12l3 2" />
        </svg>
      );
    case "calendar":
      return (
        <svg {...common}>
          <rect x="3.5" y="5.5" width="17" height="15" rx="2.5" />
          <path d="M8 3.5v4M16 3.5v4M3.5 10.5h17" />
        </svg>
      );
    case "profile":
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="3.25" />
          <path d="M5 19.5a7 7 0 0 1 14 0" />
        </svg>
      );
    case "admin":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 3.5v2.2M12 18.3v2.2M4.9 6.5l1.9 1.1M17.2 16.4l1.9 1.1M3.5 12h2.2M18.3 12h2.2M4.9 17.5l1.9-1.1M17.2 7.6l1.9-1.1" />
        </svg>
      );
    case "metrics":
      return (
        <svg {...common}>
          <path d="M4 19V5" />
          <rect x="7.5" y="12" width="3" height="7" rx="1" />
          <rect x="12.5" y="8" width="3" height="11" rx="1" />
          <rect x="17.5" y="10.5" width="3" height="8.5" rx="1" />
        </svg>
      );
    case "agent":
      return (
        <svg {...common}>
          <rect x="4" y="6" width="16" height="12" rx="3" />
          <path d="M8 10h.01M12 10h.01M16 10h.01" />
          <path d="M9 18v3l3-3" />
        </svg>
      );
    case "logout":
      return (
        <svg {...common}>
          <path d="M10 5H7.5A2.5 2.5 0 0 0 5 7.5v9A2.5 2.5 0 0 0 7.5 19H10" />
          <path d="M10 12h9" />
          <path d="M16 8.5 19.5 12 16 15.5" />
        </svg>
      );
    // An ID card: a portrait on the left, detail lines on the right.
    case "profiles":
      return (
        <svg {...common}>
          <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
          <circle cx="8.3" cy="10.8" r="2" />
          <path d="M5.3 15.9a3.2 3.2 0 0 1 6 0" />
          <path d="M14.2 10h4.3M14.2 13.6h3.1" />
        </svg>
      );
    // A brain with a rising spark: training an AI account.
    case "training":
      return (
        <svg {...common}>
          <path d="M11.3 4.6a3.4 3.4 0 0 0-3.3 3.4 3 3 0 0 0-1 5.5 3.2 3.2 0 0 0 2.9 4 2.4 2.4 0 0 0 1.4-.5V4.6Z" />
          <path d="M13.3 4.6a3.4 3.4 0 0 1 3.3 3.4 3 3 0 0 1 1 5.5 3.2 3.2 0 0 1-2.9 4 2.4 2.4 0 0 1-1.4-.5V4.6Z" />
          <path d="M12.3 19v1.6" />
        </svg>
      );
    // A clock turning back: the append-only audit log.
    case "history":
      return (
        <svg {...common}>
          <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
          <path d="M3.3 4.6v4.1h4.1" />
          <path d="M12 8.2V12l2.8 1.7" />
        </svg>
      );
    // A globe: the external sites accounts are created on.
    case "sites":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M3.5 12h17" />
          <path d="M12 3.5c2.3 2.3 3.4 5.3 3.4 8.5s-1.1 6.2-3.4 8.5c-2.3-2.3-3.4-5.3-3.4-8.5S9.7 5.8 12 3.5Z" />
        </svg>
      );
  }
}

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg className="spinner" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="42 24" />
    </svg>
  );
}

// Loading state with the Team Huddle mark held still inside a turning ring.
export function BrandSpinner({ size = 56 }: { size?: number }) {
  return (
    <span className="brand-spinner" style={{ width: size, height: size }} aria-hidden="true">
      <svg className="brand-spinner-ring" viewBox="0 0 48 48">
        <circle
          cx="24"
          cy="24"
          r="21"
          fill="none"
          stroke="var(--accent)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray="38 94"
        />
      </svg>
      <span className="brand-spinner-mark">
        <Logo size={Math.round(size * 0.42)} />
      </span>
    </span>
  );
}
