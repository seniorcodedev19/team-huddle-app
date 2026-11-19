import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import AuthShell from "@/components/AuthShell";
import { FieldIcon } from "@/components/Icons";
import { createAccount, signInWithPassword } from "@/lib/account";

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if ((await auth())?.user) redirect("/dashboard");
  const sp = await searchParams;

  return (
    <AuthShell active="signup">
      <h1 className="auth-title">Create your account</h1>
      <p className="auth-sub">
        Sign up with your work email. An admin approves new accounts, so you can sign in once yours has been
        approved.
      </p>

      {sp.error && (
        <div className="banner error" role="alert">
          {sp.error}
        </div>
      )}

      <form
        action={async (formData: FormData) => {
          "use server";
          const email = String(formData.get("email") ?? "").trim();
          const password = String(formData.get("password") ?? "");
          const name = String(formData.get("name") ?? "").trim();
          const made = await createAccount(email, password, name);
          if ("error" in made) redirect(`/signup?error=${encodeURIComponent(made.error)}`);
          // Signing in now would be refused: the account waits for an admin.
          if (!made.active) redirect("/login?notice=pending");
          await signInWithPassword(email, password);
        }}
      >
        <div className="field">
          <FieldIcon name="user" />
          <input id="name" name="name" type="text" autoComplete="name" placeholder="Your name" aria-label="Your name" />
        </div>
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
            autoComplete="new-password"
            required
            minLength={8}
            placeholder="Password (8+ characters)"
            aria-label="Password"
          />
        </div>
        <button className="btn auth-submit" type="submit">
          Sign Up
        </button>
      </form>

      <p className="auth-alt">
        Already have an account? <Link href="/login">Log In</Link>
      </p>
    </AuthShell>
  );
}
