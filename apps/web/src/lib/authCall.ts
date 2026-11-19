import { SignJWT } from "jose";

/* The API's sign-up and sign-in endpoints accept calls only from this server.
   This is the proof: a one-minute token signed with API_JWT_SECRET, the
   secret the two already share. It also carries the visitor's address, which
   the API counts wrong passwords and new accounts by.

   Server-only. The secret must never reach the browser. */
export async function authCallHeaders(incoming: { get(name: string): string | null }): Promise<Record<string, string>> {
  const secret = new TextEncoder().encode(process.env.API_JWT_SECRET ?? "");
  const token = await new SignJWT({ kind: "auth", ip: visitorAddress(incoming) })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1m")
    .sign(secret);
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

/* The hosting platform sets these on every request and overwrites whatever
   the browser sent, so the first address is the visitor's own. In local
   development it is the loopback address. */
function visitorAddress(h: { get(name: string): string | null }): string {
  return (h.get("x-real-ip") || h.get("x-forwarded-for")?.split(",")[0] || "").trim().slice(0, 64);
}
