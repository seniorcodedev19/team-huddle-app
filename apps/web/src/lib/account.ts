import { AuthError } from "next-auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { API_URL } from "@/lib/api";
import { authCallHeaders } from "@/lib/authCall";

/* Creates the account. `active` is false when it now waits for an admin's
   approval, which is the usual case: signing in straight away would fail. */
export async function createAccount(
  email: string,
  password: string,
  name: string,
): Promise<{ error: string } | { active: boolean }> {
  const proof = await authCallHeaders(await headers());
  let res: Response;
  try {
    res = await fetch(`${API_URL}/auth/signup`, {
      method: "POST",
      headers: proof,
      body: JSON.stringify({ email, password, name }),
    });
  } catch {
    return { error: `Can't reach the API at ${API_URL}. Is it running?` };
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string; active?: boolean };
  if (!res.ok) return { error: body.error ?? "Could not create the account" };
  // An API from before approval existed leaves `active` out; its accounts could sign in at once.
  return { active: body.active !== false };
}

export async function signInWithPassword(email: string, password: string, redirectTo = "/dashboard") {
  try {
    await signIn("credentials", { email, password, redirectTo });
  } catch (error) {
    if (error instanceof AuthError) {
      /* CredentialsSignin means authorize() refused the sign-in: a bad email
         or password, or one of the coded reasons it throws. Anything else
         (CallbackRouteError) means authorize() itself failed, so the sign-in
         broke for a different reason worth reporting as such. */
      const code = "code" in error ? String(error.code) : "";
      const kind =
        code === "inactive"
          ? "AccountInactive"
          : code === "throttled"
            ? "TooManyAttempts"
            : error.type === "CredentialsSignin"
              ? "CredentialsSignin"
              : "SignInFailed";
      redirect(`/login?error=${kind}`);
    }
    throw error;
  }
}
