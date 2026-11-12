"use client";

import { useRef, useState } from "react";
import RichText from "./RichText";

/* A note field with formatting: bold, italic, bulleted and numbered lists,
   and links, plus a preview of how the note will read.

   The text is stored with a small markup (see RichText), not as HTML, so it
   stays plain text in the database — profile notes are encrypted there — and
   cannot carry anything into the page. The toolbar writes the markup, so
   nobody has to know it; typing it by hand works too. */
export default function RichNoteEditor({
  id,
  value,
  onChange,
  placeholder,
  maxLength,
  disabled,
  rows = 4,
}: {
  id?: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
  rows?: number;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState(false);

  /* Replaces the selection (or the caret position) with the result of `make`,
     then puts the selection back where the user expects it. */
  const edit = (make: (selected: string) => { text: string; select?: [number, number] }) => {
    const el = area.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const { text, select } = make(value.slice(start, end));
    const next = value.slice(0, start) + text + value.slice(end);
    if (maxLength && next.length > maxLength) return;
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      const [a, b] = select ?? [text.length, text.length];
      el.setSelectionRange(start + a, start + b);
    });
  };

  const wrap = (mark: string, fallback: string) =>
    edit((sel) => {
      const inner = sel || fallback;
      // With nothing selected, the placeholder word is selected so typing replaces it.
      return { text: `${mark}${inner}${mark}`, select: [mark.length, mark.length + inner.length] };
    });

  const list = (numbered: boolean) =>
    edit((sel) => {
      const lines = (sel || "List item").split("\n");
      const text = lines.map((l, i) => `${numbered ? `${i + 1}.` : "-"} ${l.replace(/^\s*(?:[-*]|\d+[.)])\s+/, "")}`).join("\n");
      // A list has to start on its own line.
      const el = area.current;
      const before = el ? value.slice(0, el.selectionStart) : "";
      const lead = before && !before.endsWith("\n") ? "\n" : "";
      return { text: lead + text, select: [lead.length + text.length, lead.length + text.length] };
    });

  const link = () =>
    edit((sel) => {
      const label = sel || "link text";
      const url = "https://";
      const text = `[${label}](${url})`;
      // Selects the address, the part still to be filled in.
      return { text, select: [label.length + 3, label.length + 3 + url.length] };
    });

  const tool = (label: string, title: string, onClick: () => void, icon: React.ReactNode) => (
    <button
      type="button"
      className="rich-tool"
      aria-label={label}
      title={title}
      disabled={disabled || preview}
      // Keeps the selection in the textarea: a click would otherwise take focus first.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {icon}
    </button>
  );

  const svg = (d: React.ReactNode) => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {d}
    </svg>
  );

  return (
    <div className={`rich-note${disabled ? " disabled" : ""}`}>
      <div className="rich-toolbar">
        {tool("Bold", "Bold (Ctrl+B)", () => wrap("**", "bold text"), <strong aria-hidden="true">B</strong>)}
        {tool("Italic", "Italic (Ctrl+I)", () => wrap("*", "italic text"), <em aria-hidden="true">I</em>)}
        {tool("Bulleted list", "Bulleted list", () => list(false), svg(<><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1" /><circle cx="4.5" cy="12" r="1" /><circle cx="4.5" cy="18" r="1" /></>))}
        {tool("Numbered list", "Numbered list", () => list(true), svg(<><path d="M10 6h10M10 12h10M10 18h10" /><path d="M4 5h1v4M4 9h2M4 14.5a1 1 0 0 1 2 .3c0 .9-2 1.6-2 3.2h2" /></>))}
        {tool("Link", "Link", link, svg(<><path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" /><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" /></>))}
        <div className="rich-mode" role="group" aria-label="Mode">
          <button type="button" className={preview ? "" : "on"} aria-pressed={!preview} onClick={() => setPreview(false)}>
            Write
          </button>
          <button type="button" className={preview ? "on" : ""} aria-pressed={preview} onClick={() => setPreview(true)}>
            Preview
          </button>
        </div>
      </div>
      {preview ? (
        <div className="rich-preview" style={{ minHeight: `${rows * 1.5 + 1}em` }}>
          {value.trim() ? <RichText text={value} /> : <p className="muted small">Nothing to preview yet.</p>}
        </div>
      ) : (
        <textarea
          ref={area}
          id={id}
          rows={rows}
          value={value}
          maxLength={maxLength}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (!(e.ctrlKey || e.metaKey)) return;
            const k = e.key.toLowerCase();
            if (k === "b") {
              e.preventDefault();
              wrap("**", "bold text");
            } else if (k === "i") {
              e.preventDefault();
              wrap("*", "italic text");
            }
          }}
        />
      )}
    </div>
  );
}
