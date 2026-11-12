"use client";

import { useState } from "react";
import { callJson, useAction } from "@/lib/client";
import SiteLogo from "./SiteLogo";
import { Spinner } from "./Icons";
import RichNoteEditor from "./RichNoteEditor";
import type { SiteMetaPreview } from "@/lib/types";

/* Any signed-in user can add an AI training site. Paste a URL and the server
   reads the page's <head> for the name, summary and icon; the fields stay
   editable, and nothing is saved until "Add site".
   Renaming and removing stay admin-only, since every profile's matrix row
   depends on the site list staying stable. */
export default function AddSiteInline({ modal = false }: { modal?: boolean }) {
  const { error, busy, run, setError } = useAction();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [fetching, setFetching] = useState(false);
  const [meta, setMeta] = useState<SiteMetaPreview | null>(null);
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");

  const reset = () => {
    setOpen(false);
    setUrl("");
    setMeta(null);
    setName("");
    setSummary("");
    setError(null);
  };

  const fetchMeta = async () => {
    if (!url.trim()) {
      setError("Paste a URL first.");
      return;
    }
    setFetching(true);
    setError(null);
    try {
      const got = await callJson<SiteMetaPreview>("POST", "/training-sites/fetch", { url });
      setMeta(got);
      setName(got.name);
      setSummary(got.summary);
      setUrl(got.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that site.");
    } finally {
      setFetching(false);
    }
  };

  const add = async () => {
    if (!name.trim()) {
      setError("A site needs a name.");
      return;
    }
    const ok = await run("POST", "/training-sites", {
      name,
      url,
      summary,
      icon_url: meta?.icon_url ?? "",
      active: true,
    });
    if (ok) reset();
  };

  if (!open) {
    return (
      <button className="btn secondary" type="button" onClick={() => setOpen(true)}>
        Add site
      </button>
    );
  }

  const form = (
    <div className="addsite">
      <div className="addsite-url">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void fetchMeta();
            }
          }}
          placeholder="https://outlier.ai"
          aria-label="Site URL"
          autoFocus
        />
        <button className="btn secondary" type="button" onClick={fetchMeta} disabled={fetching || busy}>
          {fetching ? <Spinner size={14} /> : null}
          {fetching ? "Fetching…" : "Fetch"}
        </button>
      </div>

      {meta ? (
        <div className="addsite-preview">
          <SiteLogo name={name} iconUrl={meta.icon_url} siteUrl={meta.url || url} size={40} />
          <div className="addsite-fields">
            <label htmlFor="as-name">Name</label>
            <input id="as-name" value={name} onChange={(e) => setName(e.target.value)} />
            <label htmlFor="as-summary">Site notes</label>
            {/* Shown, formatted, as "Site notes" on every board card for this site. */}
            <RichNoteEditor
              id="as-summary"
              value={summary}
              onChange={setSummary}
              maxLength={4000}
              rows={3}
              placeholder="What this site is, and anything everyone working on it should know"
            />
          </div>
        </div>
      ) : null}

      <div className="addsite-actions">
        {/* Adding by hand stays possible when a site blocks the fetch. */}
        {!meta ? (
          <button className="btn secondary" type="button" onClick={() => setMeta({ name: "", summary: "", icon_url: "", url })}>
            Enter by hand
          </button>
        ) : null}
        <button className="btn" type="button" onClick={add} disabled={busy || fetching || !meta}>
          Add site
        </button>
        <button className="btn secondary" type="button" onClick={reset} disabled={busy}>
          Cancel
        </button>
      </div>

      {error && (
        <span className="addsite-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );

  if (!modal) return form;

  /* As a dialog: the AI Training page opens this from a toolbar button, where
     an inline form would push the whole board down. The backdrop closes it,
     matching the nav drawer and the rest of the app. */
  return (
    <>
      <button className="btn secondary" type="button" onClick={() => setOpen(true)}>
        Add site
      </button>
      <div className="modal-backdrop" onClick={reset} aria-hidden="true" />
      <div className="modal" role="dialog" aria-modal="true" aria-label="Add a training site">
        <div className="modal-head">
          <h2>Add a training site</h2>
          <button type="button" className="drawer-close modal-close" onClick={reset} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <p className="sub" style={{ marginTop: 0 }}>
          Paste a URL and fetch the name, summary and icon from the site.
        </p>
        {form}
      </div>
    </>
  );
}
