"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { call, callJson, useAction } from "@/lib/client";
import type { ManicTimeAdmin, ManicTimePerson, ManicTimeSyncSummary } from "@/lib/types";
import Dropdown from "./Dropdown";
import { Spinner } from "./Icons";
import TimeAgo from "./TimeAgo";

type Check = { people: number; timelines: { usage: number; tags: number; autotags: number } };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/* Admin → ManicTime: where the server is and how to sign in, the last sync,
   and which ManicTime user is which person here. */
export default function AdminManicTime({ data }: { data: ManicTimeAdmin }) {
  return (
    <div className="stack mt-admin">
      <Connection data={data} />
      <Sync data={data} />
      <People data={data} />
    </div>
  );
}

function Connection({ data }: { data: ManicTimeAdmin }) {
  const { error, busy, run, setError } = useAction();
  const [url, setUrl] = useState(data.server_url || "http://localhost:8080");
  const [mode, setMode] = useState<ManicTimeAdmin["auth_mode"]>(data.auth_mode);
  const [username, setUsername] = useState(data.username);
  const [secret, setSecret] = useState("");
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState<Check | null>(null);
  const router = useRouter();

  // A saved secret only counts while the sign-in method it belongs to is picked.
  const secretSaved = data.has_secret && mode === data.auth_mode;
  const canSave = url.trim() !== "" && (mode === "token" || username.trim() !== "") && (secretSaved || secret !== "");

  const save = async () => {
    setChecked(null);
    const ok = await run("PUT", "/manictime/config", {
      server_url: url.trim(),
      auth_mode: mode,
      username: username.trim(),
      ...(secret ? { secret } : {}),
    });
    if (ok) setSecret("");
  };

  const check = async () => {
    setError(null);
    setChecked(null);
    setChecking(true);
    try {
      setChecked(await callJson<Check>("POST", "/manictime/test"));
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The check failed.");
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="panel">
      <h2 className="mt-title">Connection</h2>
      <p className="muted small mt-help">
        Sign in as a ManicTime user with the <strong>Administrator</strong> role, so the sync can read everyone&apos;s
        timelines. On ManicTime Server 2026.3 or later with the new sign-in system, create an API token on its
        Developer page and choose API token.
      </p>

      <div className="mt-form">
        <div className="mt-wide">
          <label htmlFor="mt-url">Server address</label>
          <input
            id="mt-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="http://localhost:8080"
            autoComplete="off"
          />
        </div>
        <div>
          <label htmlFor="mt-mode">Sign in with</label>
          <Dropdown<ManicTimeAdmin["auth_mode"]>
            id="mt-mode"
            ariaLabel="Sign in with"
            value={mode}
            onChange={(v) => {
              setMode(v);
              setSecret("");
            }}
            options={[
              { value: "password", label: "Username and password" },
              { value: "token", label: "API token" },
            ]}
          />
        </div>
        {mode === "password" && (
          <div>
            <label htmlFor="mt-user">Username</label>
            <input id="mt-user" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
          </div>
        )}
        <div className={mode === "token" ? "mt-wide" : undefined}>
          <label htmlFor="mt-secret">{mode === "token" ? "API token" : "Password"}</label>
          <input
            id="mt-secret"
            type="password"
            autoComplete="new-password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={secretSaved ? "Saved — type to replace" : mode === "token" ? "mt_api_…" : ""}
          />
        </div>
      </div>

      <div className="row" style={{ marginTop: 14 }}>
        <button className="btn" type="button" disabled={!canSave || busy || checking} onClick={save}>
          Save
        </button>
        <button
          className="btn secondary"
          type="button"
          disabled={!data.configured || busy || checking}
          onClick={check}
          title={data.configured ? "Sign in and list ManicTime users" : "Save the connection first"}
        >
          {checking ? <Spinner size={14} /> : null}
          {checking ? "Checking…" : "Check connection"}
        </button>
      </div>
      {error && (
        <div className="msg error" role="alert">
          {error}
        </div>
      )}
      {checked && (
        <div className="msg mt-ok" role="status">
          Connected. {plural(checked.people, "ManicTime user")}, {plural(checked.timelines.usage, "computer usage timeline")}
          , {plural(checked.timelines.tags + checked.timelines.autotags, "tag timeline")}.
        </div>
      )}
    </div>
  );
}

function Sync({ data }: { data: ManicTimeAdmin }) {
  const router = useRouter();
  const [from, setFrom] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ManicTimeSyncSummary | null>(null);
  const summary = result ?? data.sync_summary;
  // A failure newer than the last success, as the server recorded it.
  const failed = !result && data.sync_error;

  const sync = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await callJson<ManicTimeSyncSummary>("POST", "/manictime/sync", from ? { from } : {}));
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The sync failed.");
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <h2 className="mt-title">Sync</h2>
      <p className="muted small mt-help">
        Last synced: {data.synced_at ? <TimeAgo iso={data.synced_at} /> : "never"}. While the API runs on the
        ManicTime machine it also syncs every 15 minutes. If the API runs somewhere else, schedule{" "}
        <code>npm run mt:sync</code> on the ManicTime machine instead.
      </p>

      <div className="row">
        <div>
          <label htmlFor="mt-from">From (optional)</label>
          <input id="mt-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <button className="btn" type="button" disabled={!data.configured || busy} onClick={sync}>
          {busy ? <Spinner size={14} /> : null}
          {busy ? "Syncing…" : "Sync now"}
        </button>
        <span className="muted small" style={{ alignSelf: "center" }}>
          Leave From empty to sync last week and this week. At most 92 days at a time.
        </span>
      </div>

      {error && (
        <div className="msg error" role="alert">
          {error}
        </div>
      )}
      {!error && failed && (
        <div className="msg error" role="alert">
          The last sync failed: {data.sync_error}
        </div>
      )}
      {summary && (
        <div className="mt-summary" role="status">
          <div>
            {result ? "Synced" : "Last sync covered"} {summary.from} → {summary.to}:{" "}
            {plural(summary.days, "day")} of active time and {plural(summary.tags, "tag row")} for{" "}
            {summary.linked} of {plural(summary.people, "ManicTime user")}.
            {summary.locked > 0 &&
              ` ${plural(summary.locked, "day")} of score time left as they were, in submitted or approved weeks.`}{" "}
            <Link href="/time">See it on Time tracking</Link>
          </div>
          {summary.warnings.map((w) => (
            <div key={w} className="banner note mt-warning">
              {w}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function People({ data }: { data: ManicTimeAdmin }) {
  const linkedTo = new Map(
    data.people.filter((p) => p.user_id !== null).map((p) => [p.user_id as number, p.display_name]),
  );
  return (
    <div className="panel tablewrap">
      <h2 className="mt-title">People</h2>
      <p className="muted small mt-help">
        Each ManicTime user&apos;s time goes to the person linked here. People are matched by email or name when
        ManicTime is first read; change any link below. Links take effect on the next sync.
      </p>
      {data.people.length === 0 ? (
        <div className="empty">No ManicTime users yet. Check the connection to list them.</div>
      ) : (
        <table className="mt-people">
          <thead>
            <tr>
              <th>ManicTime user</th>
              <th className="n">Computers</th>
              <th>Person here</th>
            </tr>
          </thead>
          <tbody>
            {data.people.map((p) => (
              <PersonRow key={`${p.mt_username}:${p.user_id}`} person={p} users={data.users} linkedTo={linkedTo} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function PersonRow({
  person,
  users,
  linkedTo,
}: {
  person: ManicTimePerson;
  users: ManicTimeAdmin["users"];
  linkedTo: Map<number, string>;
}) {
  const router = useRouter();
  const [value, setValue] = useState<number>(person.user_id ?? 0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const change = async (next: number) => {
    const prev = value;
    setValue(next);
    setSaving(true);
    setError(null);
    const r = await call("PATCH", `/manictime/people/${encodeURIComponent(person.mt_username)}`, {
      user_id: next === 0 ? null : next,
    });
    setSaving(false);
    if (!r.ok) {
      setValue(prev);
      setError(r.error);
      return;
    }
    router.refresh();
  };

  return (
    <tr>
      <td>
        <div>{person.display_name || person.mt_username}</div>
        {person.display_name && person.display_name !== person.mt_username && (
          <div className="muted small">{person.mt_username}</div>
        )}
      </td>
      <td className="n">{person.devices}</td>
      <td>
        <Dropdown<number>
          ariaLabel={`Person linked to ${person.display_name || person.mt_username}`}
          className="mt-person-dd"
          value={value}
          disabled={saving}
          onChange={(v) => void change(v)}
          options={[
            { value: 0, label: "Not linked" },
            ...users.map((u) => {
              const other = linkedTo.get(u.id);
              const elsewhere = other !== undefined && u.id !== person.user_id;
              return {
                value: u.id,
                label: u.name,
                hint: elsewhere ? `Linked to ${other}` : u.email,
                disabled: elsewhere,
              };
            }),
          ]}
        />
        {error && (
          <div className="msg error" role="alert">
            {error}
          </div>
        )}
      </td>
    </tr>
  );
}
