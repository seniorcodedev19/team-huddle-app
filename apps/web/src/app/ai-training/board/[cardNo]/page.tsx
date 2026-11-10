import Link from "next/link";
import { notFound } from "next/navigation";
import CardPanel, { CardTitle } from "@/components/CardPanel";
import { tryFetch } from "@/lib/api";
import type { BoardCard } from "@/lib/types";

/* A board card on its own page.

   The modal over the board shows the same panel, but a modal has no URL. This
   route is what a notification, a Slack message or a pasted link can point
   at. */
export default async function CardPage({ params }: { params: Promise<{ cardNo: string }> }) {
  const { cardNo } = await params;
  const n = Number(cardNo);
  if (!Number.isInteger(n) || n < 1) notFound();

  const res = await tryFetch<BoardCard>(`/cards/${n}`);
  /* A card that isn't there is a wrong URL, not a failure worth a banner.
     Anything else — the API down, a bad token — keeps the banner, because
     retrying is the right response to those and not-found is not. */
  if (!res.ok) {
    if (/doesn't exist/i.test(res.error)) notFound();
    return (
      <>
        <BoardCrumb />
        <div className="banner error" role="alert">
          {res.error}
        </div>
      </>
    );
  }

  return (
    <>
      <BoardCrumb cardNo={n} />
      <div className="panel card-page">
        <CardTitle card={res.data} />
        <CardPanel card={res.data} />
      </div>
    </>
  );
}

function BoardCrumb({ cardNo }: { cardNo?: number }) {
  return (
    <nav className="crumb" aria-label="Breadcrumb">
      <Link href="/ai-training">AI Training</Link>
      <span aria-hidden="true">›</span>
      {cardNo ? <span>TRN-{cardNo}</span> : <span>Card</span>}
    </nav>
  );
}
