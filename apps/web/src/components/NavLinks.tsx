"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Icon } from "./Icons";

export type NavItem = { href: string; label: string; children?: NavItem[] };

const icons = {
  "/dashboard": "dashboard",
  "/team": "team",
  "/time": "time",
  "/calendar": "calendar",
  "/agent": "agent",
  "/profiles": "profiles",
  "/ai-training": "training",
  "/profile": "profile",
  "/admin": "admin",
  "/admin/users": "team",
  "/admin/metrics": "metrics",
  "/admin/agent": "agent",
  "/admin/training-sites": "sites",
  "/admin/history": "history",
} as const;

function isCurrent(href: string, path: string) {
  if (href === "/admin") return path === "/admin" || path.startsWith("/admin/");
  return path === href || path.startsWith(`${href}/`);
}

export default function NavLinks({ links }: { links: NavItem[] }) {
  const path = usePathname();
  const [open, setOpen] = useState<Record<string, boolean>>({});

  return (
    <>
      {links.map((l) => {
        const icon = icons[l.href as keyof typeof icons];
        const expanded = open[l.href] ?? isCurrent(l.href, path);
        return (
          <div key={l.href} className="nav-group">
            {/* A parent with children only opens and closes its submenu — the
                subitems are the pages — so it is a button, not a link. */}
            {l.children?.length ? (
              <button
                type="button"
                className={`link nav-parent${isCurrent(l.href, path) ? " within" : ""}`}
                aria-expanded={expanded}
                onClick={() => setOpen((s) => ({ ...s, [l.href]: !expanded }))}
              >
                {icon ? <Icon name={icon} /> : null}
                <span>{l.label}</span>
                <span className={`nav-caret${expanded ? " open" : ""}`}>▸</span>
              </button>
            ) : (
              <Link
                href={l.href}
                className="link"
                aria-current={isCurrent(l.href, path) ? "page" : undefined}
              >
                {icon ? <Icon name={icon} /> : null}
                <span>{l.label}</span>
              </Link>
            )}
            {l.children?.length && expanded ? (
              <div className="nav-sub">
                {l.children.map((c) => {
                  const childIcon = icons[c.href as keyof typeof icons];
                  return (
                    <Link
                      key={c.href}
                      href={c.href}
                      className="link"
                      aria-current={isCurrent(c.href, path) ? "page" : undefined}
                    >
                      {childIcon ? <Icon name={childIcon} /> : null}
                      <span>{c.label}</span>
                    </Link>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
    </>
  );
}
