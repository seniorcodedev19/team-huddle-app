import InterviewsPanel from "@/components/InterviewsPanel";
import { apiFetch, tryFetch } from "@/lib/api";
import type { Interview, TeamProfile, User } from "@/lib/types";

export default async function InterviewsPage() {
  const me = await apiFetch<User>("/me");
  const [list, profiles] = await Promise.all([
    tryFetch<Interview[]>("/interviews"),
    tryFetch<TeamProfile[]>("/profiles"),
  ]);

  return (
    <>
      <h1>Interviews</h1>
      <p className="sub">Scheduled interviews between a profile and a client. Click a slot to add one.</p>
      {list.ok ? (
        <InterviewsPanel
          me={me}
          interviews={list.data}
          profiles={profiles.ok ? profiles.data : []}
        />
      ) : (
        <div className="banner error">{list.error}</div>
      )}
    </>
  );
}
