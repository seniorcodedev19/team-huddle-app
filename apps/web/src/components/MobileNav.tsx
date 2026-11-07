"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Logo } from "./Icons";

/* The sidebar as a phone drawer.

   The desktop sidebar is a fixed 236px column. Below 860px there isn't room
   for it beside the content, and the eight nav items are too many to lay out
   as a wrapping top bar — they stacked into eight full-width rows and pushed
   the page off-screen. So on small screens the sidebar slides in over the
   content instead, behind a hamburger in a compact top bar.

   This component owns only the open/closed state and the chrome around it;
   the sidebar itself is still rendered by Nav. */
export default function MobileNav({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  /* The desktop sidebar's collapsed state. The attribute on <html> is the
     source of truth, not React: the pre-paint script in layout sets it
     before first render so a collapsed sidebar never flashes open. This
     subscribes to that attribute rather than mirroring it in state, which
     also keeps the server and client renders agreeing. Separate from
     `open`, which is the phone drawer. */
  const subscribe = useCallback((onChange: () => void) => {
    const ob = new MutationObserver(onChange);
    ob.observe(document.documentElement, { attributes: true, attributeFilter: ["data-nav"] });
    return () => ob.disconnect();
  }, []);
  const collapsed = useSyncExternalStore(
    subscribe,
    () => document.documentElement.getAttribute("data-nav") === "off",
    // The server has no sidebar preference; it renders the expanded default.
    () => false,
  );

  const toggleSidebar = () => {
    const root = document.documentElement;
    const next = !collapsed;
    if (next) root.setAttribute("data-nav", "off");
    else root.removeAttribute("data-nav");
    try {
      localStorage.setItem("nav", next ? "off" : "on");
    } catch {
      // A blocked localStorage only costs the preference, not the toggle.
    }
  };

  /* Following a link closes the drawer — otherwise it covers the page you
     just asked for. Caught here rather than watching the path, so the drawer
     shuts on the click instead of a render later. The Admin parent only
     expands its submenu, so it must not close the drawer: it's a <button>,
     and only an <a> counts as navigating away. */
  const closeIfNavigating = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("a")) setOpen(false);
  };

  // Escape closes it, as for any dialog.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  /* Lock the page behind the drawer so a scroll gesture over the backdrop
     doesn't move the content underneath. */
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <header className="topbar">
        <button
          type="button"
          className="topbar-burger"
          aria-label="Open menu"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
        <span className="topbar-brand">
          <Logo size={22} />
          <span>
            <span className="brand-mark">Team</span> Huddle
          </span>
        </span>
      </header>

      {/* Collapses the desktop sidebar. Hidden on phones, where the drawer
          and its hamburger already do this job. */}
      <button
        type="button"
        className="nav-collapse"
        aria-label={collapsed ? "Show sidebar" : "Hide sidebar"}
        aria-expanded={!collapsed}
        title={collapsed ? "Show sidebar" : "Hide sidebar"}
        onClick={toggleSidebar}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d={collapsed ? "m9 6 6 6-6 6" : "m15 6-6 6 6 6"} />
        </svg>
      </button>

      {/* Sits above the content, below the drawer; clicking it closes. */}
      {open && (
        <div className="nav-backdrop" onClick={() => setOpen(false)} aria-hidden="true" />
      )}

      <div className={`nav-drawer${open ? " open" : ""}`} onClick={closeIfNavigating}>
        <button
          type="button"
          className="drawer-close"
          aria-label="Close menu"
          onClick={() => setOpen(false)}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
        {children}
      </div>
    </>
  );
}
