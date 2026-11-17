import ContactsPanel from "@/components/ContactsPanel";
import { tryFetch } from "@/lib/api";
import { CONTACT_STATUSES } from "@/lib/contacts";
import type { ContactPage, ContactStatus, ProfilePerson, User } from "@/lib/types";

/* The filters and the page live in the URL (?q=&status=&assignee=&page=),
   so a filtered view can be linked to, and a save that refreshes the page
   comes back to the same rows. */
export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; assignee?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const filters = {
    q: (sp.q ?? "").slice(0, 100),
    status: (CONTACT_STATUSES as string[]).includes(sp.status ?? "") ? (sp.status as ContactStatus) : "",
    assignee: Number(sp.assignee) || 0,
    page: Math.max(1, Number(sp.page) || 1),
  } as const;

  const qs = new URLSearchParams();
  if (filters.q) qs.set("q", filters.q);
  if (filters.status) qs.set("status", filters.status);
  if (filters.assignee) qs.set("assignee", String(filters.assignee));
  qs.set("page", String(filters.page));

  const [c, people, me] = await Promise.all([
    tryFetch<ContactPage>(`/contacts?${qs}`),
    tryFetch<ProfilePerson[]>("/profile-people"),
    tryFetch<User>("/me"),
  ]);

  if (!c.ok) return <div className="banner error">{c.error}</div>;
  if (!me.ok) return <div className="banner error">{me.error}</div>;

  return (
    <>
      <div className="head">
        <div>
          <h1>Contacts</h1>
          <p className="sub" style={{ margin: 0 }}>
            People the team is in touch with. Every detail is stored encrypted.
          </p>
        </div>
      </div>

      <ContactsPanel data={c.data} filters={filters} people={people.ok ? people.data : []} me={me.data} />
    </>
  );
}
