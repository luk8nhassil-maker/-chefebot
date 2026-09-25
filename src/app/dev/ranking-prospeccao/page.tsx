import { notFound } from "next/navigation";
import RankingProspeccaoPreview from "./RankingProspeccaoPreview";

export default function RankingProspeccaoPreviewPage() {
  if (process.env.VERCEL_ENV === "production") notFound();
  return <RankingProspeccaoPreview />;
}
