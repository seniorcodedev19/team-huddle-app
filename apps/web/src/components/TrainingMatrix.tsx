"use client";

import { useMemo, useState } from "react";
import { useAction } from "@/lib/client";
import { STATUS_LABEL, STATUS_TONE, STATUSES } from "@/lib/training";
import TrainingKanban from "./TrainingKanban";
import AddSiteInline from "./AddSiteInline";
import SiteLogo from "./SiteLogo";
import Dropdown from "./Dropdown";
import Avatar from "./Avatar";
import RichText, { plainText } from "./RichText";
import type { ProfileAssignee, TrainingMatrix as Matrix, TrainingStatus } from "@/lib/types";

type View = "table" | "kanban" | "cards";

/* The bare domain, for the line under a card's title. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/* Rows are AI training sites, columns are profiles. Each cell is that
   profile's account status on that site, editable in place. */
export default function TrainingMatrix({ matrix }: { matrix: Matrix }) {
  const { error, busy, run } = useAction();
  const [view, setView] = useState<View>("table");

  /* Board filters. They live here rather than in TrainingKanban so their
     controls can sit in the toolbar beside Add site; the board receives the
     values. 0 means "no filter" on each. */
  const [fProfile, setFProfile] = useState(0);
  const [fSite, setFSite] = useState(0);
  const [fAssignee, setFAssignee] = useState(0);
  const anyFilter = fProfile !== 0 || fSite !== 0 || fAssignee !== 0;

  /* Only people actually assigned to a training profile: offering every
     user would mostly list options that match nothing. */
  const assigneeOptions = useMemo(() => {
    const seen = new Map<number, ProfileAssignee>();
    for (const p of matrix.profiles) for (const a of p.assignees ?? []) seen.set(a.user_id, a);
    return [...seen.values()].sort((x, y) => x.name.localeCompare(y.name));
  }, [matrix.profiles]);

  // (profile_id, site_id) -> status, for O(1) cell lookup.
  const cells = useMemo(() => {
    const m = new Map<string, TrainingStatus>();
    for (const a of matrix.accounts) m.set(`${a.profile_id}:${a.site_id}`, a.status);
    return m;
  }, [matrix.accounts]);

  // (profile_id, site_id) -> account id, so a card can remove an account.
  const ids = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of matrix.accounts) m.set(`${a.profile_id}:${a.site_id}`, a.id);
    return m;
  }, [matrix.accounts]);

  const setStatus = (profileId: number, siteId: number, status: TrainingStatus) =>
    run("PUT", "/training-accounts", { profile_id: profileId, site_id: siteId, status });

  const removeAccount = (accountId: number) => run("DELETE", `/training-accounts/${accountId}`);

  if (matrix.sites.length === 0) {
    return (
      <>
        <div className="profiles-bar">
          <AddSiteInline />
        </div>
        <div className="empty">No AI training sites yet. Add the first one above.</div>
      </>
    );
  }
  if (matrix.profiles.length === 0) {
    return <div className="empty">No profiles yet. Create one on the Profiles page first.</div>;
  }

  const counts = (siteId: number) => {
    const tally: Partial<Record<TrainingStatus, number>> = {};
    for (const p of matrix.profiles) {
      const s = cells.get(`${p.id}:${siteId}`);
      if (s) tally[s] = (tally[s] ?? 0) + 1;
    }
    return tally;
  };

  return (
    <>
      {error && (
        <div className="banner error" role="alert">
          {error}
        </div>
      )}

      <div className="profiles-bar">
        <div className="viewswitch" role="group" aria-label="View">
          <button
            type="button"
            className={view === "table" ? "on" : ""}
            onClick={() => setView("table")}
            aria-pressed={view === "table"}
          >
            Table
          </button>
          <button
            type="button"
            className={view === "kanban" ? "on" : ""}
            onClick={() => setView("kanban")}
            aria-pressed={view === "kanban"}
          >
            Board
          </button>
          <button
            type="button"
            className={view === "cards" ? "on" : ""}
            onClick={() => setView("cards")}
            aria-pressed={view === "cards"}
          >
            Cards
          </button>
        </div>
        {/* Board filters sit with the view switch and Add site, so the
            toolbar holds every control for the page. Only the board uses
            them, so they appear only on it. */}
        {view === "kanban" && (
          <>
            <Dropdown<number>
              value={fProfile}
              ariaLabel="Filter by profile"
              onChange={setFProfile}
              options={[
                { value: 0, label: "All profiles" },
                ...matrix.profiles.map((p) => ({ value: p.id, label: p.full_name })),
              ]}
            />
            <Dropdown<number>
              value={fSite}
              ariaLabel="Filter by training site"
              onChange={setFSite}
              options={[
                { value: 0, label: "All sites" },
                ...matrix.sites.map((x) => ({
                  value: x.id,
                  label: x.name,
                  media: <SiteLogo name={x.name} iconUrl={x.icon_url} siteUrl={x.url} size={18} />,
                })),
              ]}
            />
            <Dropdown<number>
              value={fAssignee}
              ariaLabel="Filter by assignee"
              onChange={setFAssignee}
              options={[
                { value: 0, label: "All assignees" },
                ...assigneeOptions.map((a) => ({
                  value: a.user_id,
                  label: a.name,
                  media: <Avatar name={a.name} email={a.email} src={a.avatar} size={20} />,
                })),
              ]}
            />
            {anyFilter && (
              <button
                className="btn secondary small"
                type="button"
                onClick={() => {
                  setFProfile(0);
                  setFSite(0);
                  setFAssignee(0);
                }}
              >
                Clear
              </button>
            )}
          </>
        )}
        <span className="bar-end">
          <AddSiteInline modal />
        </span>
      </div>

      {view === "kanban" ? (
        <TrainingKanban
          matrix={matrix}
          filters={{ profileId: fProfile, siteId: fSite, assignee: fAssignee }}
        />
      ) : view === "table" ? (
        <div className="panel" style={{ padding: 0, overflowX: "auto" }}>
          <table className="matrix">
            <thead>
              <tr>
                <th className="person-col">AI training site</th>
                {matrix.profiles.map((p) => (
                  <th key={p.id} title={p.full_name}>
                    {p.full_name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.sites.map((site) => (
                <tr key={site.id}>
                  <th scope="row" className="person-col">
                    <span className="site-cell" title={site.summary ? plainText(site.summary) : undefined}>
                      <SiteLogo name={site.name} iconUrl={site.icon_url} siteUrl={site.url} size={20} />
                      {site.url ? (
                        <a href={site.url} target="_blank" rel="noreferrer noopener">
                          {site.name}
                        </a>
                      ) : (
                        site.name
                      )}
                    </span>
                  </th>
                  {matrix.profiles.map((p) => {
                    const status = cells.get(`${p.id}:${site.id}`);
                    return (
                      <td key={p.id} className={status ? `cell status-${STATUS_TONE[status]}` : "cell"}>
                        <Dropdown<TrainingStatus>
                          value={status ?? ""}
                          placeholder="—"
                          tone={status ? STATUS_TONE[status] : undefined}
                          ariaLabel={`${site.name} status for ${p.full_name}`}
                          disabled={busy}
                          onChange={(st) => setStatus(p.id, site.id, st)}
                          options={STATUSES.map((st) => ({
                            value: st,
                            label: STATUS_LABEL[st],
                            media: <span className={`dd-dot tone-${STATUS_TONE[st]}`} />,
                          }))}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="profile-grid">
          {matrix.sites.map((site) => {
            const tally = counts(site.id);
            return (
              <article className="panel profile-card site-card" key={site.id}>
                <header className="site-head">
                  <SiteLogo name={site.name} iconUrl={site.icon_url} siteUrl={site.url} size={38} />
                  <div className="site-head-text">
                    <h3>
                      {site.url ? (
                        <a href={site.url} target="_blank" rel="noreferrer noopener">
                          {site.name}
                        </a>
                      ) : (
                        site.name
                      )}
                    </h3>
                    {site.url ? (
                      <span className="site-host">{hostOf(site.url)}</span>
                    ) : null}
                  </div>
                </header>
                {site.summary ? <RichText text={site.summary} className="site-summary" /> : null}
                {/* With no accounts the card shows nothing here, so the add
                    button is the only thing left to act on. */}
                {Object.keys(tally).length > 0 && (
                  <div className="chips" style={{ marginBottom: 10 }}>
                    {STATUSES.filter((s) => tally[s]).map((s) => (
                      <span className={`chip status-${STATUS_TONE[s]}`} key={s}>
                        {STATUS_LABEL[s]} {tally[s]}
                      </span>
                    ))}
                  </div>
                )}
                <SiteAccounts
                  site={site}
                  profiles={matrix.profiles}
                  cells={cells}
                  ids={ids}
                  busy={busy}
                  onSet={setStatus}
                  onRemove={removeAccount}
                />
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}

/* The profiles that have an account on this site. Profiles without one sit
   behind "Add a profile", matching the table view: a cell only shows where an
   account exists. */
function SiteAccounts({
  site,
  profiles,
  cells,
  ids,
  busy,
  onSet,
  onRemove,
}: {
  site: Matrix["sites"][number];
  profiles: Matrix["profiles"];
  cells: Map<string, TrainingStatus>;
  ids: Map<string, number>;
  busy: boolean;
  onSet: (profileId: number, siteId: number, status: TrainingStatus) => void;
  onRemove: (accountId: number) => void;
}) {
  const [adding, setAdding] = useState(false);
  const withAccount = profiles.filter((p) => cells.has(`${p.id}:${site.id}`));
  const without = profiles.filter((p) => !cells.has(`${p.id}:${site.id}`));

  return (
    <div className="accounts">
      {withAccount.map((p) => {
          const status = cells.get(`${p.id}:${site.id}`)!;
          const accountId = ids.get(`${p.id}:${site.id}`);
          return (
            <div className="account-row" key={p.id}>
              <span className="account-site" title={p.full_name}>
                {p.full_name}
              </span>
              <Dropdown<TrainingStatus>
                value={status}
                tone={STATUS_TONE[status]}
                ariaLabel={`${site.name} status for ${p.full_name}`}
                disabled={busy}
                onChange={(st) => onSet(p.id, site.id, st)}
                options={STATUSES.map((st) => ({
                  value: st,
                  label: STATUS_LABEL[st],
                  media: <span className={`dd-dot tone-${STATUS_TONE[st]}`} />,
                }))}
              />
              {accountId ? (
                <button
                  type="button"
                  className="account-remove"
                  onClick={() => onRemove(accountId)}
                  disabled={busy}
                  aria-label={`Remove ${p.full_name} from ${site.name}`}
                  title="Remove this account"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                    <path d="M6 6l12 12M18 6 6 18" />
                  </svg>
                </button>
              ) : null}
            </div>
          );
      })}

      {adding ? (
        <div className="account-add">
          <Dropdown<number>
            value=""
            placeholder="Pick a profile…"
            ariaLabel={`Add a profile to ${site.name}`}
            disabled={busy}
            onChange={(profileId) => {
              onSet(profileId, site.id, STATUSES[0]);
              setAdding(false);
            }}
            options={without.map((p) => ({ value: p.id, label: p.full_name }))}
          />
          <button className="btn secondary small" type="button" onClick={() => setAdding(false)}>
            Cancel
          </button>
        </div>
      ) : without.length > 0 ? (
        <button className="btn secondary small account-addbtn" type="button" onClick={() => setAdding(true)} disabled={busy}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Add a profile
        </button>
      ) : null}
    </div>
  );
}
