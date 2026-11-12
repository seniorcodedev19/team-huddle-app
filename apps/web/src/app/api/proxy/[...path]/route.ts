import { NextRequest, NextResponse } from "next/server";
import { API_URL, signApiToken } from "@/lib/api";

// Browser -> Next.js (session cookie) -> Express (signed token).
// Keeps the API off the public CORS surface and avoids cross-domain cookies.
async function handler(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const token = await signApiToken();
  if (!token) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { path } = await ctx.params;
  const hasBody = !["GET", "HEAD"].includes(req.method);
  let res: Response;
  try {
    res = await fetch(`${API_URL}/${path.join("/")}${req.nextUrl.search}`, {
      method: req.method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: hasBody ? await req.text() : undefined,
      cache: "no-store",
      /* Ends the upstream request when the browser goes away. For an
         ordinary call that is merely tidy; for a long-lived stream it is
         what stops the API holding a subscription for a closed tab. */
      signal: req.signal,
    });
  } catch {
    return NextResponse.json({ error: "Can't reach the API" }, { status: 503 });
  }

  const headers = new Headers();
  headers.set("Content-Type", res.headers.get("Content-Type") ?? "application/json");
  const disposition = res.headers.get("Content-Disposition");
  if (disposition) headers.set("Content-Disposition", disposition);
  if (headers.get("Content-Type")?.includes("text/event-stream")) {
    headers.set("Cache-Control", "no-cache");
    return new NextResponse(res.body, { status: res.status, headers });
  }
  return new NextResponse(await res.text(), { status: res.status, headers });
}

export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE };
