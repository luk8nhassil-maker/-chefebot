import { notFound } from "next/navigation";
import { headers } from "next/headers";
import RankingProspeccaoPreview from "./RankingProspeccaoPreview";

export default async function RankingProspeccaoPreviewPage() {
  await headers(); // Nunca pré-renderizar a fixture no build de produção.
  if (process.env.NODE_ENV !== "development" && process.env.VERCEL_ENV !== "preview") notFound();
  return <RankingProspeccaoPreview />;
}
