"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { callJson } from "@/lib/client";
import { Spinner } from "./Icons";

type ImportResult = { created: number; updated: number; skipped: string[] };

/* Export contacts as CSV, and import a CSV back.

   Import is open to everyone, as adding and editing are. Export is for
   admins only: the file holds every detail decrypted, outside the
   encrypted store. It exports what the filters currently show.

   Import matches on email, or on a name only one contact has; a match is
   updated, anything else added, nothing deleted. */
export default function ContactsCsv({ isAdmin, exportQuery }: { isAdmin: boolean; exportQuery: string }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ name: string; csv: string; rows: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const pick = async (file: File | undefined) => {
    setError(null);
    setResult(null);
    if (!file) return;
    if (file.size > 380_000) {
      setError("That file is larger than 380 KB. Split it and import each part.");
      return;
    }
    const csv = await file.text();
    // Non-blank lines minus the header: a rough count, for the confirmation only.
    const rows = Math.max(0, csv.split(/\r?\n/).filter((l) => l.trim() !== "").length - 1);
    if (rows === 0) {
      setError("That file has no rows below the header.");
      return;
    }
    setPending({ name: file.name, csv, rows });
  };

  const clearPending = () => {
    setPending(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const apply = async () => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      const r = await callJson<ImportResult>("POST", "/contacts/import", { csv: pending.csv });
      setResult(r);
      clearPending();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The import failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="csv-actions">
      <div className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
        {isAdmin && (
          /* A plain link: the proxy forwards Content-Disposition, so the
             browser downloads the file instead of navigating to it. */
          <a
            className="btn secondary"
            href={`/api/proxy/contacts.csv${exportQuery ? `?${exportQuery}` : ""}`}
            download
            title="Download the contacts the filters show, as CSV"
          >
            Export
          </a>
        )}
        <button
          className="btn secondary"
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          title="Add or update contacts from a CSV file"
        >
          Import
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="visually-hidden"
          onChange={(e) => void pick(e.target.files?.[0])}
        />
      </div>

      {(error || result || pending) && (
        <div className="csv-drop">
          {error && (
            <div className="banner error" role="alert">
              {error}
            </div>
          )}

          {result && (
            <div className="banner" role="status">
              Imported: {result.created} added, {result.updated} updated
              {result.skipped.length > 0 ? `, ${result.skipped.length} skipped` : ""}.
              {result.skipped.length > 0 && (
                <ul className="csv-skipped">
                  {result.skipped.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {pending && (
            <div className="csv-confirm">
              <p>
                <strong>{pending.name}</strong> — {pending.rows} row{pending.rows === 1 ? "" : "s"}. Contacts are
                matched by email (or by a name only one contact has): matches are updated, the rest added. Nothing
                is deleted.
              </p>
              <p className="muted small" style={{ margin: "0 0 8px" }}>
                Columns: name, job_title, location, email, phone, linkedin_url, github_url, portfolio_url, status,
                assignee_email, note. Only name is required; columns left out are not changed.
              </p>
              <div className="row" style={{ gap: 8 }}>
                <button className="btn" type="button" onClick={apply} disabled={busy}>
                  {busy ? <Spinner size={14} /> : null}
                  {busy ? "Importing…" : `Import ${pending.rows} row${pending.rows === 1 ? "" : "s"}`}
                </button>
                <button className="btn secondary" type="button" onClick={clearPending} disabled={busy}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
