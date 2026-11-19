import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import AuthShell from "@/components/AuthShell";
import { FieldIcon } from "@/components/Icons";
import { signInWithPassword } from "@/lib/account";

const googleReady = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const sp = await searchParams;
  // The API rejected this session's token. The browser cookie may still look
  // valid, so skip the usual bounce to the dashboard — it would loop.
  const expired = sp.error === "SessionExpired";
  if (!expired && (await auth())?.user) redirect("/dashboard");
  const badCreds = sp.error === "CredentialsSignin";
  const signInFailed = sp.error === "SignInFailed" || sp.error === "CallbackRouteError";
  const inactive = sp.error === "AccountInactive";
  const throttled = sp.error === "TooManyAttempts";
  // Arriving from /signup: the account exists, and waits for an admin.
  const created = sp.notice === "pending";

  return (
    <AuthShell active="login">
      <h1 className="auth-title">Welcome back</h1>
      <p className="auth-sub">Sign in to continue to Team Huddle.</p>

      {expired && (
        <div className="banner error" role="alert">
          Your session has expired. Sign in again to continue.
        </div>
      )}
      {badCreds && (
        <div className="banner error" role="alert">
          Invalid email or password.
        </div>
      )}
      {signInFailed && (
        <div className="banner error" role="alert">
          Sign-in couldn&apos;t be completed. The server didn&apos;t respond, so your
          details weren&apos;t checked. Try again in a moment.
        </div>
      )}
      {created && !sp.error && (
        <div className="banner note" role="status">
          Your account has been created. An admin needs to approve it before you can sign in.
        </div>
      )}
      {inactive && (
        <div className="banner error" role="alert">
          This account isn&apos;t active yet. An admin needs to approve it before you can sign in.
        </div>
      )}
      {throttled && (
        <div className="banner error" role="alert">
          Too many sign-in attempts. Wait 15 minutes and try again.
        </div>
      )}
      {sp.error && !badCreds && !signInFailed && !expired && !inactive && !throttled && (
        <div className="banner error" role="alert">
          Sign-in was refused. Use an account from your company domain.
        </div>
      )}

      <form
        action={async (formData: FormData) => {
          "use server";
          await signInWithPassword(String(formData.get("email") ?? ""), String(formData.get("password") ?? ""));
        }}
      >
        <div className="field">
          <FieldIcon name="mail" />
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            required
            placeholder="Email address"
            aria-label="Email address"
          />
        </div>
        <div className="field">
          <FieldIcon name="lock" />
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            placeholder="Password"
            aria-label="Password"
          />
        </div>
        <button className="btn auth-submit" type="submit">
          Log In
        </button>
      </form>

      {googleReady && (
        <>
          <p className="auth-or">
            <span>or</span>
          </p>
          <form
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: "/dashboard" });
            }}
          >
            <button className="btn secondary auth-submit" type="submit">
              <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#4285F4" d="M21.6 12.23c0-.73-.07-1.43-.19-2.1H12v4h5.38a4.6 4.6 0 0 1-2 3.02v2.5h3.24c1.89-1.74 2.98-4.3 2.98-7.42Z" />
                <path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.43l-3.24-2.5c-.9.6-2.04.96-3.38.96-2.6 0-4.8-1.75-5.59-4.1H3.06v2.58A10 10 0 0 0 12 22Z" />
                <path fill="#FBBC05" d="M6.41 13.93a6 6 0 0 1 0-3.84V7.5H3.06a10 10 0 0 0 0 9z" />
                <path fill="#EA4335" d="M12 5.98c1.47 0 2.79.5 3.83 1.5l2.87-2.87C16.95 2.98 14.7 2 12 2a10 10 0 0 0-8.94 5.5l3.35 2.59C7.2 7.73 9.4 5.98 12 5.98Z" />
              </svg>
              Continue with Google
            </button>
          </form>
        </>
      )}

      <p className="auth-alt">
        Don&apos;t have an account? <Link href="/signup">Sign Up</Link>
      </p>
    </AuthShell>
  );
}
