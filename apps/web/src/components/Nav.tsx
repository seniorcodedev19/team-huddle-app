import { signOut } from "@/auth";
import type { User } from "@/lib/types";
import type { NavItem } from "./NavLinks";
import { Logo } from "./Icons";
import LogoutButton from "./LogoutButton";
import NavLinks from "./NavLinks";
import UserMenu from "./UserMenu";

export default function Nav({ me }: { me: User }) {
  const links: NavItem[] = [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/team", label: "Team" },
    { href: "/time", label: "Time tracking" },
    { href: "/calendar", label: "Calendar" },
    { href: "/agent", label: "Agent" },
    { href: "/profiles", label: "Profiles" },
    { href: "/ai-training", label: "AI Training" },
  ];
  if (me.role === "admin") {
    links.push({
      href: "/admin",
      label: "Admin",
      children: [
        { href: "/admin/history", label: "History" },
        { href: "/admin/users", label: "Users" },
        { href: "/admin/metrics", label: "Metrics" },
        { href: "/admin/agent", label: "Agent connect" },
        { href: "/admin/training-sites", label: "Training sites" },
      ],
    });
  }

  return (
    <nav className="side" aria-label="Main">
      <div className="brand brand-stack">
        <span className="brand-logo">
          <Logo size={46} />
        </span>
        <span className="brand-text">
          <span className="brand-mark">Team</span> Huddle
        </span>
      </div>
      <NavLinks links={links} />
      <div className="side-footer">
        <UserMenu
          me={me}
          logout={
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/" });
              }}
            >
              <LogoutButton />
            </form>
          }
        />
      </div>
    </nav>
  );
}
