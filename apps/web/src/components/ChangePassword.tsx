"use client";

import { useState } from "react";
import { useAction } from "@/lib/client";

/* Changing your own password. The API asks for the current one again, so a
   session left open is not enough to change it. */
export default function ChangePassword() {
  const { error, busy, run } = useAction();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [saved, setSaved] = useState(false);
  const mismatch = again.length > 0 && next !== again;

  return (
    <form
      className="stack"
      style={{ maxWidth: 420 }}
      /* Saved in place, with no navigation for the page-level busy state to wait on. */
      data-busy="local"
      onSubmit={async (e) => {
        e.preventDefault();
        if (next !== again) return;
        setSaved(false);
        if (await run("POST", "/profile/password", { current, next })) {
          setCurrent("");
          setNext("");
          setAgain("");
          setSaved(true);
        }
      }}
    >
      <div>
        <label htmlFor="pw-current">Current password</label>
        <input
          id="pw-current"
          type="password"
          autoComplete="current-password"
          required
          style={{ width: "100%" }}
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
      </div>
      <div>
        <label htmlFor="pw-next">New password</label>
        <input
          id="pw-next"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={200}
          style={{ width: "100%" }}
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
        <p className="muted small field-hint">
          At least 8 characters. Longer is better; avoid common passwords and your own name.
        </p>
      </div>
      <div>
        <label htmlFor="pw-again">New password, again</label>
        <input
          id="pw-again"
          type="password"
          autoComplete="new-password"
          required
          style={{ width: "100%" }}
          value={again}
          onChange={(e) => setAgain(e.target.value)}
        />
      </div>
      {mismatch && (
        <div className="msg error" role="alert">
          The two new passwords don&apos;t match.
        </div>
      )}
      <div className="row">
        <button className="btn" type="submit" disabled={busy || !current || next.length < 8 || next !== again}>
          Change password
        </button>
        {saved && <span role="status">Password changed. Use the new one next time you sign in.</span>}
      </div>
      {error && (
        <div className="msg error" role="alert">
          {error}
        </div>
      )}
    </form>
  );
}
