"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { callJson } from "@/lib/client";
import type { CardComment, ProfileAssignee } from "@/lib/types";
import Avatar from "./Avatar";
import ConfirmDialog from "./ConfirmDialog";
import TimeAgo from "./TimeAgo";

/* The comment thread on a card, with an @ picker in the composer.

   Comments are fetched and posted here rather than through useAction(): the
   thread is the only thing that changes, so a router.refresh() would re-pull
   the whole board to add one line. */
export default function CardComments({ cardNo }: { cardNo: number }) {
  const [items, setItems] = useState<CardComment[] | null>(null);
  const [people, setPeople] = useState<ProfileAssignee[]>([]);
  const [body, setBody] = useState("");
  /* Who is looking: the action menu only appears on your own comments, and
     an admin additionally gets delete on anyone's. */
  const [me, setMe] = useState<{ id: number; role: string } | null>(null);
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  /* The comment awaiting a delete confirmation, and whether the delete is
     in flight. */
  const [deleting, setDeleting] = useState<number | null>(null);
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* Ids the picker resolved, kept alongside the text. A name typed by hand
     notifies nobody — only a pick counts, which is what the API enforces. */
  const [picked, setPicked] = useState<ProfileAssignee[]>([]);

  /* The @ query: null when the picker is closed, otherwise the text typed
     since the @. */
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const ac = new AbortController();
    callJson<CardComment[]>("GET", `/cards/${cardNo}/comments`, undefined, ac.signal)
      .then(setItems)
      .catch((e: unknown) => {
        if (ac.signal.aborted) return;
        setItems([]);
        setError(e instanceof Error ? e.message : "Couldn't load comments");
      });
    return () => ac.abort();
  }, [cardNo]);

  useEffect(() => {
    const ac = new AbortController();
    callJson<{ id: number; role: string }>("GET", "/me", undefined, ac.signal)
      .then(setMe)
      .catch(() => {
        /* Without it the menus stay hidden, which fails closed. */
      });
    return () => ac.abort();
  }, []);

  // The picker list is small and rarely changes, so it loads once with the thread.
  useEffect(() => {
    const ac = new AbortController();
    callJson<ProfileAssignee[]>("GET", "/mentionables", undefined, ac.signal)
      .then(setPeople)
      .catch(() => {
        /* The picker is a convenience; losing it must not block commenting. */
      });
    return () => ac.abort();
  }, []);

  /* Name -> person, for turning an @name in a posted comment back into a
     chip. Built from the same list the picker uses. */
  const byName = useMemo(() => new Map(people.map((p) => [p.name, p])), [people]);

  useEffect(() => {
    if (menuFor === null) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".comment-menu")) setMenuFor(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuFor]);

  const matches =
    query === null
      ? []
      : people
          .filter((p) => {
            const q = query.toLowerCase();
            return p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q);
          })
          .slice(0, 6);

  /* Reads the word being typed just before the caret. Only a run of
     non-space characters after an @ counts, so an email address mid-sentence
     does not open the picker. */
  const syncQuery = (el: HTMLTextAreaElement) => {
    const upto = el.value.slice(0, el.selectionStart ?? 0);
    const m = /(?:^|\s)@([^\s@]*)$/.exec(upto);
    setQuery(m ? m[1] : null);
    setActive(0);
  };

  const choose = (p: ProfileAssignee) => {
    const el = area.current;
    if (!el) return;
    const caret = el.selectionStart ?? body.length;
    const upto = body.slice(0, caret);
    const m = /(?:^|\s)@([^\s@]*)$/.exec(upto);
    if (!m) return;
    const start = upto.length - m[1].length - 1; // back over the @ and the typed text
    const next = `${body.slice(0, start)}@${p.name} ${body.slice(caret)}`;
    setBody(next);
    setPicked((list) => (list.some((x) => x.user_id === p.user_id) ? list : [...list, p]));
    setQuery(null);
    // Put the caret after the inserted name rather than at the end of the box.
    requestAnimationFrame(() => {
      const at = start + p.name.length + 2;
      el.focus();
      el.setSelectionRange(at, at);
    });
  };

  const submit = async () => {
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    try {
      /* Only ids whose name still appears in the text are sent: picking
         someone and then deleting the mention should not notify them. */
      const mentions = picked.filter((p) => text.includes(`@${p.name}`)).map((p) => p.user_id);
      const saved = await callJson<CardComment>("POST", `/cards/${cardNo}/comments`, {
        body: text,
        mentions,
      });
      setItems((list) => [...(list ?? []), saved]);
      setBody("");
      setPicked([]);
      setQuery(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't post that comment");
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async (id: number) => {
    const text = draft.trim();
    if (!text) return;
    setError(null);
    try {
      /* Mentions are re-resolved from the edited text against the people
         list, so adding or removing a name while editing takes effect. */
      const mentions = people.filter((p) => text.includes(`@${p.name}`)).map((p) => p.user_id);
      const saved = await callJson<CardComment>("PATCH", `/comments/${id}`, { body: text, mentions });
      setItems((list) => (list ?? []).map((c) => (c.id === saved.id ? saved : c)));
      setEditing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that edit");
    }
  };

  const remove = async (id: number) => {
    setError(null);
    setRemoving(true);
    try {
      await callJson<{ ok: true }>("DELETE", `/comments/${id}`);
      setItems((list) => (list ?? []).filter((c) => c.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete that comment");
    } finally {
      setRemoving(false);
      setDeleting(null);
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (query !== null && matches.length) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => (i + 1) % matches.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => (i - 1 + matches.length) % matches.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        choose(matches[active]);
        return;
      }
      if (e.key === "Escape") {
        // Close the picker without closing the modal around it.
        e.preventDefault();
        e.stopPropagation();
        setQuery(null);
        return;
      }
    }
    // Enter sends; Shift+Enter makes a new line.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <section className="card-comments">
      <h3 className="card-section">
        Comments{items && items.length > 0 ? ` (${items.length})` : ""}
      </h3>

      {error && (
        <div className="banner error" role="alert">
          {error}
        </div>
      )}

      <div className="comment-compose">
        <textarea
          ref={area}
          value={body}
          rows={3}
          maxLength={4000}
          disabled={busy}
          placeholder="Write a comment… use @ to mention someone"
          onChange={(e) => {
            setBody(e.target.value);
            syncQuery(e.target);
          }}
          onClick={(e) => syncQuery(e.currentTarget)}
          onBlur={() => {
            /* After the click that picks a name, not before it. */
            setTimeout(() => setQuery(null), 120);
          }}
          onKeyDown={onKey}
          aria-label="Write a comment"
        />

        {query !== null && matches.length > 0 && (
          <ul className="mention-list" role="listbox">
            {matches.map((p, i) => (
              <li key={p.user_id}>
                <button
                  type="button"
                  className={`mention-opt${i === active ? " active" : ""}`}
                  // mousedown fires before blur, so the pick is not lost.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(p);
                  }}
                  onMouseEnter={() => setActive(i)}
                >
                  <Avatar name={p.name} email={p.email} src={p.avatar} size={22} />
                  <span className="mention-text">
                    <strong>{p.name}</strong>
                    <span className="muted small">{p.email}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="row" style={{ justifyContent: "flex-end", marginTop: 8 }}>
          <button className="btn" type="button" onClick={submit} disabled={busy || !body.trim()}>
            Comment
          </button>
        </div>
      </div>

      {/* History runs newest first, under the composer: the box you type
          in stays put at the top instead of moving down as the thread
          grows, and the newest comment is the one you land on. */}
      {items === null ? (
        <p className="muted small">Loading…</p>
      ) : items.length === 0 ? (
        <p className="muted small">No comments yet.</p>
      ) : (
        <ul className="comment-list">
          {[...items].reverse().map((c) => (
            <li key={c.id}>
              <Avatar name={c.author.name} email={c.author.email} src={c.author.avatar} size={26} />
              <div className="comment-text">
                <p className="comment-meta">
                  <strong>{c.author.name}</strong>
                  <TimeAgo className="muted small" iso={c.created_at} />
                  {c.edited_at && <span className="muted small">(edited)</span>}
                  {me && (c.author.user_id === me.id || me.role === "admin") && (
                    <span className="comment-menu">
                      <button
                        type="button"
                        className="icon-action"
                        aria-label="Comment actions"
                        aria-expanded={menuFor === c.id}
                        onClick={() => setMenuFor((m) => (m === c.id ? null : c.id))}
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                          <circle cx="5" cy="12" r="1.6" />
                          <circle cx="12" cy="12" r="1.6" />
                          <circle cx="19" cy="12" r="1.6" />
                        </svg>
                      </button>
                      {menuFor === c.id && (
                        <span className="comment-menu-pop" role="menu">
                          {/* An admin may remove anyone's comment, but never
                              rewrite it under their name. */}
                          {c.author.user_id === me.id && (
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setEditing(c.id);
                                setDraft(c.body);
                                setMenuFor(null);
                              }}
                            >
                              Edit
                            </button>
                          )}
                          <button
                            type="button"
                            role="menuitem"
                            className="danger"
                            onClick={() => {
                              setMenuFor(null);
                              setDeleting(c.id);
                            }}
                          >
                            Delete
                          </button>
                        </span>
                      )}
                    </span>
                  )}
                </p>
                {editing === c.id ? (
                  <div className="comment-edit">
                    <textarea
                      value={draft}
                      rows={3}
                      maxLength={4000}
                      onChange={(e) => setDraft(e.target.value)}
                      aria-label="Edit comment"
                    />
                    <div className="row" style={{ gap: 6, marginTop: 6 }}>
                      <button
                        className="btn small"
                        type="button"
                        onClick={() => saveEdit(c.id)}
                        disabled={!draft.trim()}
                      >
                        Save
                      </button>
                      <button
                        className="btn secondary small"
                        type="button"
                        onClick={() => setEditing(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="comment-body">{highlight(c.body, byName)}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}


      {deleting !== null && (
        <ConfirmDialog
          title="Delete this comment?"
          message="It will be removed for everyone on this card. This cannot be undone."
          confirmLabel="Delete"
          danger
          busy={removing}
          onConfirm={() => void remove(deleting)}
          onCancel={() => setDeleting(null)}
        />
      )}
    </section>
  );
}

/* Renders @names as a chip carrying the person's avatar and colour. Plain
   text otherwise — this is not markdown.

   Names can hold spaces ("Daniel Ong"), so a pattern alone cannot say where
   a mention ends. Matching against the known names, longest first, is what
   makes "@Daniel Ong" one chip rather than "@Daniel" plus stray text. */
function highlight(text: string, people: Map<string, ProfileAssignee>) {
  const names = [...people.keys()].sort((a, b) => b.length - a.length);
  const out: React.ReactNode[] = [];
  let buf = "";
  let i = 0;

  const flush = () => {
    if (buf) {
      out.push(<span key={`t${out.length}`}>{buf}</span>);
      buf = "";
    }
  };

  while (i < text.length) {
    if (text[i] === "@") {
      const rest = text.slice(i + 1);
      const hit = names.find((n) => rest.startsWith(n));
      if (hit) {
        flush();
        const person = people.get(hit)!;
        out.push(
          <span className={`mention tone-${colourOf(person.user_id)}`} key={`m${out.length}`}>
            <Avatar name={person.name} email={person.email} src={person.avatar} size={16} />
            {person.name}
          </span>,
        );
        i += hit.length + 1;
        continue;
      }
    }
    buf += text[i];
    i += 1;
  }
  flush();
  return out;
}

/* A stable colour per person, from the chart series already in the palette,
   so the same name is the same colour everywhere it appears. */
function colourOf(userId: number) {
  return userId % 6;
}
