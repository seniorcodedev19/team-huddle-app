import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import ColumnChart from "@/components/ColumnChart";
import { Logo } from "@/components/Icons";
import ThemeToggle from "@/components/ThemeToggle";

const sample = [
  { label: "Sun", value: 0 },
  { label: "Mon", value: 14 },
  { label: "Tue", value: 21 },
  { label: "Wed", value: 11 },
  { label: "Thu", value: 24, highlight: true },
  { label: "Fri", value: 18 },
  { label: "Sat", value: 0 },
];

const benefits = [
  "Weekly reports and insights",
  "Daily sync and check-ins",
  "Visualize progress",
  "Team collaboration",
];

/* Small cards that float over the hero image, as in the product shot. */
function FloatCard({
  className,
  icon,
  children,
}: {
  className: string;
  icon: "calendar" | "report" | "chart" | "chat";
  children: React.ReactNode;
}) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };
  const art = {
    calendar: (
      <svg {...common}>
        <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
        <path d="M3.5 10h17M8 3v4M16 3v4M9 15l2 2 4-4" />
      </svg>
    ),
    report: (
      <svg {...common}>
        <path d="M5 19V11M10 19V5M15 19v-5M20 19v-9" />
      </svg>
    ),
    chart: (
      <svg {...common}>
        <path d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5H12Z" />
        <path d="M15.5 3.2A8.5 8.5 0 0 1 20.8 8.5H15.5Z" />
      </svg>
    ),
    chat: (
      <svg {...common}>
        <path d="M20.5 12.2c0 3.9-3.8 7-8.5 7a9.8 9.8 0 0 1-2.6-.35L4.5 20.5l1.1-3.4a6.6 6.6 0 0 1-2.1-4.9c0-3.9 3.8-7 8.5-7s8.5 3.1 8.5 7Z" />
      </svg>
    ),
  }[icon];

  return (
    <div className={`float-card ${className}`} aria-hidden="true">
      <span className="float-card-icon">{art}</span>
      <span className="float-card-text">{children}</span>
    </div>
  );
}

export default async function Landing() {
  if ((await auth())?.user) redirect("/dashboard");

  return (
    <div className="landing">
      <header className="landing-nav">
        <Link href="/" className="brand" style={{ padding: 0, textDecoration: "none" }}>
          <span className="brand-logo">
            <Logo size={18} />
          </span>
          <span className="brand-text">
            <span className="brand-mark">Team</span> Huddle
          </span>
        </Link>

        <nav className="landing-links" aria-label="About this app">
          <a href="#features">Features</a>
          <a href="#how">How it works</a>
          <a href="#example">Example week</a>
        </nav>

        <div className="landing-cta">
          <ThemeToggle />
          <Link className="btn secondary" href="/login">
            Login
          </Link>
          <Link className="btn" href="/signup">
            Sign Up
          </Link>
        </div>
      </header>

      <section className="hero-split">
        <div className="hero">
          <p className="hero-badge">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M13.5 2 4 13.2h6.3L9.8 22l9.7-11.4h-6.4L13.5 2Z" />
            </svg>
            Work Better. Together.
          </p>
          <h1 className="display">Team Huddle</h1>
          <p className="display-sub">Connect. Collaborate. Achieve More.</p>
          <p className="lead">
            The team app for syncing goals, tracking progress each week, and building a stronger team.
          </p>
          <ul className="hero-points">
            {benefits.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
          <div className="row">
            <Link className="btn big" href="/signup">
              Get Started Free
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 12h15M13 6l6 6-6 6" />
              </svg>
            </Link>
            <Link className="btn secondary big" href="/login">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M8 5.5v13l11-6.5-11-6.5Z" />
              </svg>
              Sign in
            </Link>
          </div>
        </div>

        {/* Hero image: apps/web/public/team-photo.jpg */}
        <figure className="hero-figure">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="hero-photo"
            src="/team-photo.jpg"
            alt="A team looking at a laptop together with an AI assistant"
            width={1400}
            height={933}
            fetchPriority="high"
          />

          <FloatCard className="float-tl" icon="calendar">
            Daily
            <br />
            Sync
          </FloatCard>
          <FloatCard className="float-tr" icon="report">
            Weekly
            <br />
            Report
          </FloatCard>
          <FloatCard className="float-mr" icon="chart">
            Visualize
          </FloatCard>
          <FloatCard className="float-br" icon="chat">
            Collaborate
          </FloatCard>
        </figure>
      </section>

      <section className="steps" id="features">
        <div>
          <div className="n">1</div>
          <h3>Track time and weekly results</h3>
          <p>Hours come from ManicTime. Other metrics are one total for the week.</p>
        </div>
        <div>
          <div className="n">2</div>
          <h3>Submit at the weekend</h3>
          <p>Your total is already worked out. Add a note and send the week for review.</p>
        </div>
        <div>
          <div className="n">3</div>
          <h3>Your manager approves</h3>
          <p>They approve it or send it back with a comment, and the final score is locked in.</p>
        </div>
      </section>

      <section className="panel" aria-label="Example week" id="example">
        <div className="head" style={{ marginBottom: 8 }}>
          <div>
            <strong>Example week</strong>
            <div className="muted">Points earned each day</div>
          </div>
          <div className="score">
            <span className="num" style={{ fontSize: 36 }}>
              88
            </span>
            <span className="unit">points so far</span>
          </div>
        </div>
        <ColumnChart items={sample} unit="" label="Example of points earned per day" />
      </section>
    </div>
  );
}
