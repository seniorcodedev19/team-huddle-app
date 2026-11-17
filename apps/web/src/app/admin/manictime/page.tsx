import { redirect } from "next/navigation";
import AdminManicTime from "@/components/AdminManicTime";
import { apiFetch, tryFetch } from "@/lib/api";
import type { ManicTimeAdmin, User } from "@/lib/types";

export default async function AdminManicTimePage() {
  const me = await apiFetch<User>("/me");
  if (me.role !== "admin") redirect("/dashboard");
  const res = await tryFetch<ManicTimeAdmin>("/manictime");

  return (
    <>
      <h1>ManicTime</h1>
      <p className="sub">
        Time Tracking comes from ManicTime: each person&apos;s active computer time feeds their score, and the time
        under each ManicTime tag is listed on Time tracking. ManicTime is only read, never changed.
      </p>
      {res.ok ? <AdminManicTime data={res.data} /> : <div className="banner error">{res.error}</div>}
    </>
  );
}
