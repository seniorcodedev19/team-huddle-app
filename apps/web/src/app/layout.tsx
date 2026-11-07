// Self-hosted so builds never depend on reaching fonts.googleapis.com.
import "@fontsource-variable/ibm-plex-sans";
import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import Script from "next/script";
import { Suspense } from "react";
import { auth, signOut } from "@/auth";
import BusyShell from "@/components/Busy";
import { Logo } from "@/components/Icons";
import MobileNav from "@/components/MobileNav";
import Nav from "@/components/Nav";
import ThemeToggle from "@/components/ThemeToggle";
import { tryFetch } from "@/lib/api";
import { navScript, themeScript } from "@/lib/theme-script";
import type { User } from "@/lib/types";

export const metadata: Metadata = { title: "Team Huddle", description: "Weekly team reviews and collaboration" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  let me: User | null = null;
  let error: string | null = null;
  if (session?.user?.email) {
    const res = await tryFetch<User>("/me");
    me = res.ok ? res.data : null;
    error = res.ok ? null : res.error;
  }

  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Script id="theme-init" strategy="beforeInteractive">
          {themeScript}
        </Script>
        <Script id="nav-init" strategy="beforeInteractive">
          {navScript}
        </Script>
        <Suspense fallback={null}>
          <BusyShell>
            {me ? (
              <div className="shell">
                {/* MobileNav is inert above 860px: it only adds the top bar
                    and drawer chrome, which CSS hides on wider screens. */}
                <MobileNav>
                  <Nav me={me} />
                </MobileNav>
                <main className="main">{children}</main>
              </div>
            ) : (
              <main className="main solo">
                <div className="solo-head">
                  <Link href="/" className="brand" style={{ padding: 0, textDecoration: "none" }}>
                    <span className="brand-logo">
                      <Logo size={17} />
                    </span>
                    <span className="brand-text">
                      <span className="brand-mark">Team</span> Huddle
                    </span>
                  </Link>
                  <ThemeToggle />
                </div>
                {error ? (
                  <div className="banner error" role="alert">
                    <strong>Can&apos;t load your account.</strong> {error}
                    <form
                      action={async () => {
                        "use server";
                        await signOut({ redirectTo: "/login" });
                      }}
                    >
                      <button className="btn secondary" type="submit" style={{ marginTop: 10 }}>
                        Sign out
                      </button>
                    </form>
                  </div>
                ) : (
                  children
                )}
              </main>
            )}
          </BusyShell>
        </Suspense>
      </body>
    </html>
  );
}
