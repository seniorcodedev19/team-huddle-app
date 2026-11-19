import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { authCallHeaders } from "@/lib/authCall";

const domain = process.env.ALLOWED_EMAIL_DOMAIN?.trim().toLowerCase();
const googleReady = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
const apiUrl = process.env.API_URL ?? "http://localhost:4000";

/* Reasons a password sign-in is refused other than a wrong password. The
   code travels to /login, which has a sentence for each. */
class AccountInactive extends CredentialsSignin {
  code = "inactive";
}
class TooManyAttempts extends CredentialsSignin {
  code = "throttled";
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  providers: [
    ...(googleReady
      ? [
          Google({
            authorization: { params: { prompt: "select_account", ...(domain ? { hd: domain } : {}) } },
          }),
        ]
      : []),
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(creds, request) {
        const email = String(creds?.email ?? "").trim();
        const password = String(creds?.password ?? "");
        if (!email || !password) return null;
        // The API takes sign-ins only from this server, and counts attempts by the visitor's address.
        const headers = await authCallHeaders(request.headers);
        let res: Response;
        try {
          res = await fetch(`${apiUrl}/auth/login`, {
            method: "POST",
            headers,
            body: JSON.stringify({ email, password }),
          });
        } catch {
          // The API is unreachable. Throwing keeps this distinct from a wrong
          // password, which returns null, so the page can say which it was.
          throw new Error(`Can't reach the API at ${apiUrl}. Is it running?`);
        }
        if (res.status === 403) throw new AccountInactive();
        if (res.status === 429) throw new TooManyAttempts();
        if (res.status === 401) {
          /* A wrong email or password, unless the API turned away this
             server itself: then the two do not share API_JWT_SECRET, and
             calling it a wrong password would send people round in circles. */
          const body = (await res.json().catch(() => ({}))) as { code?: string };
          if (body.code === "web_only") throw new Error("The API refused this server. API_JWT_SECRET must be the same in both.");
          return null;
        }
        if (!res.ok) throw new Error(`The API returned ${res.status} while signing in.`);
        const user = (await res.json()) as { id: number; email: string; name: string };
        return { id: String(user.id), email: user.email, name: user.name };
      },
    }),
  ],
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider === "google") {
        if (!profile?.email_verified) return false;
        if (domain && !profile.email?.toLowerCase().endsWith(`@${domain}`)) return false;
      }
      return true;
    },
  },
});
