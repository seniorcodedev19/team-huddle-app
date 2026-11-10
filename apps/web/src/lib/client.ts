"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useBusy } from "@/components/Busy";

export async function call(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(`/api/proxy${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.ok) return { ok: true };
    const j = await res.json().catch(() => ({}));
    return { ok: false, error: j.error ?? `Request failed (${res.status})` };
  } catch {
    return { ok: false, error: "Network error. Try again." };
  }
}

/* Like call(), but hands back the parsed response. For the few endpoints that
   answer with data the browser needs rather than just succeeding — reading a
   site's metadata before anything is saved. Rejects so the caller can catch. */
export async function callJson<T>(
  method: string,
  path: string,
  body?: unknown,
  /* Lets a caller cancel in an effect cleanup. An aborted fetch rejects, so
     the caller checks signal.aborted before showing the error. */
  signal?: AbortSignal,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/proxy${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new Error("Network error. Try again.");
  }
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error ?? `Request failed (${res.status})`);
  return j as T;
}

// Run a request, show its error, refresh server data on success.
export function useAction() {
  const router = useRouter();
  const { startAction, stopAction } = useBusy();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (method: string, path: string, body?: unknown) => {
    setError(null);
    setBusy(true);
    startAction();
    try {
      const r = await call(method, path, body);
      if (!r.ok) setError(r.error);
      else router.refresh();
      return r.ok;
    } finally {
      setBusy(false);
      stopAction();
    }
  };
  return { error, busy, run, setError };
}
