"use client";

import { useState } from "react";
import { callJson, useAction } from "@/lib/client";
import AddSiteInline from "./AddSiteInline";
import { Spinner } from "./Icons";
import RichNoteEditor from "./RichNoteEditor";
import { plainText } from "./RichText";
import SiteLogo from "./SiteLogo";
import Switch from "./Switch";
import type { SiteMetaPreview, TrainingSite } from "@/lib/types";

/* Admin-managed list of AI training sites. These become the rows of the
   status matrix, so every profile is measured against the same set. */
export default function TrainingSitesManager({ sites }: { sites: TrainingSite[] }) {
  const { error, busy, run, setError } = useAction();
  const [editing, setEditing] = useState<number | null>(null);
  /* Deleting a site cascades to every training account on it, so the row asks
     once before going through with it. */
  const [confirming, setConfirming] = useState<number | null>(null);

  return (
    <>
      {error && (
        <div className="banner error" role="alert">
          {error}
        </div>
      )}

      <div className="panel">
        <h2 className="panel-title">Add a training site</h2>
        <p className="sub">Paste a URL and fetch the name, summary and icon from the site.</p>
        <AddSiteInline />
      </div>

      {sites.length === 0 ? (
        <div className="empty">No training sites yet.</div>
      ) : (
        <div className="panel" style={{ padding: 0, overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Site</th>
                <th>URL</th>
                <th>Active</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sites.map((s) =>
                editing === s.id ? (
                  <SiteEditRow
                    key={s.id}
                    site={s}
                    busy={busy}
                    onCancel={() => {
                      setEditing(null);
                      setError(null);
                    }}
                    onSave={async (patch) => {
                      const ok = await run("PATCH", `/training-sites/${s.id}`, patch);
                      if (ok) setEditing(null);
                    }}
                  />
                ) : (
                  <tr key={s.id}>
                    <td>
                      <span className="site-cell">
                        <SiteLogo name={s.name} iconUrl={s.icon_url} siteUrl={s.url} size={24} />
                        <span>
                          <strong>{s.name}</strong>
                          {s.summary ? <span className="site-summary-sm">{plainText(s.summary)}</span> : null}
                        </span>
                      </span>
                    </td>
                    <td>
                      {s.url ? (
                        <a href={s.url} target="_blank" rel="noreferrer noopener">
                          {s.url}
                        </a>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      <span className="switch-row">
                        <Switch
                          label={`${s.name} is active`}
                          checked={s.active}
                          disabled={busy}
                          onChange={(next) =>
                            run("PATCH", `/training-sites/${s.id}`, { active: next })
                          }
                        />
                        <span className="muted">{s.active ? "Active" : "Hidden"}</span>
                      </span>
                    </td>
                    <td>
                      <span className="row-actions">
                        <button
                          className="icon-action"
                          type="button"
                          onClick={() => {
                            setError(null);
                            setEditing(s.id);
                          }}
                          disabled={busy}
                          aria-label={`Edit ${s.name}`}
                          title="Edit"
                        >
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M12 20h8" />
                            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7.5 18.5l-4 1 1-4Z" />
                          </svg>
                        </button>
                        {confirming === s.id ? (
                          <>
                            <span className="muted small">Delete this site?</span>
                            <button
                              className="btn danger small"
                              type="button"
                              onClick={async () => {
                                await run("DELETE", `/training-sites/${s.id}`);
                                setConfirming(null);
                              }}
                              disabled={busy}
                            >
                              Delete
                            </button>
                            <button
                              className="btn secondary small"
                              type="button"
                              onClick={() => setConfirming(null)}
                              disabled={busy}
                            >
                              Keep
                            </button>
                          </>
                        ) : (
                          <button
                            className="btn secondary small"
                            type="button"
                            onClick={() => {
                              setError(null);
                              setConfirming(s.id);
                            }}
                            disabled={busy}
                          >
                            Delete
                          </button>
                        )}
                      </span>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* The row turns into its own fields in place. Name, URL and summary are the
   three an admin actually corrects — a typo'd name, a moved URL, a summary the
   fetch got wrong. The icon keeps whatever the fetch stored, and SiteLogo
   falls back to the URL's favicon, so a changed URL still updates the logo. */
function SiteEditRow({
  site,
  busy,
  onCancel,
  onSave,
}: {
  site: TrainingSite;
  busy: boolean;
  onCancel: () => void;
  onSave: (patch: { name: string; url: string; summary: string; icon_url?: string }) => void;
}) {
  const [name, setName] = useState(site.name);
  const [url, setUrl] = useState(site.url);
  const [summary, setSummary] = useState(site.summary);
  const [icon, setIcon] = useState(site.icon_url);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const dirty =
    name !== site.name || url !== site.url || summary !== site.summary || icon !== site.icon_url;

  /* Re-read the site's own page. Useful when a site has rebranded, or when it
     was added before the fetch existed and has no icon or summary stored. */
  const refetch = async () => {
    if (!url.trim()) {
      setFetchError("Add a URL first.");
      return;
    }
    setFetching(true);
    setFetchError(null);
    try {
      const got = await callJson<SiteMetaPreview>("POST", "/training-sites/fetch", { url });
      // Only overwrite with what the site actually gave back.
      if (got.name) setName(got.name);
      if (got.summary) setSummary(got.summary);
      if (got.icon_url) setIcon(got.icon_url);
      if (got.url) setUrl(got.url);
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Couldn't read that site.");
    } finally {
      setFetching(false);
    }
  };

  const save = () => {
    if (!name.trim()) return;
    onSave({
      name: name.trim(),
      url: url.trim(),
      summary: summary.trim(),
      ...(icon !== site.icon_url ? { icon_url: icon } : {}),
    });
  };

  return (
    <tr className="site-edit-row">
      <td colSpan={4}>
        <div className="site-edit">
          <SiteLogo name={name} iconUrl={icon} siteUrl={url} size={38} />
          <div className="site-edit-fields">
            <label htmlFor={`se-name-${site.id}`}>Name</label>
            <input
              id={`se-name-${site.id}`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  save();
                }
                if (e.key === "Escape") onCancel();
              }}
              autoFocus
            />
            <label htmlFor={`se-url-${site.id}`}>URL</label>
            <input
              id={`se-url-${site.id}`}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  save();
                }
                if (e.key === "Escape") onCancel();
              }}
              placeholder="https://example.com"
            />
            <label htmlFor={`se-summary-${site.id}`}>Site notes</label>
            {/* Shown, formatted, as "Site notes" on every board card for this site. */}
            <RichNoteEditor
              id={`se-summary-${site.id}`}
              value={summary}
              onChange={setSummary}
              maxLength={4000}
              rows={4}
              placeholder="What this site is, and anything everyone working on it should know"
            />
          </div>
          <div className="site-edit-actions">
            {/* Re-reads the page at the URL above and refills these fields. */}
            <button
              className="btn secondary"
              type="button"
              onClick={refetch}
              disabled={busy || fetching}
            >
              {fetching ? <Spinner size={13} /> : null}
              {fetching ? "Fetching…" : "Fetch"}
            </button>
            <button
              className="btn"
              type="button"
              onClick={save}
              disabled={busy || fetching || !name.trim() || !dirty}
            >
              Save
            </button>
            <button className="btn secondary" type="button" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
            {fetchError && (
              <span className="addsite-error" role="alert">
                {fetchError}
              </span>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}
