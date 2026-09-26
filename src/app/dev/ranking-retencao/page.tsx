import { notFound } from "next/navigation";
import RankingRetencaoPreview from "./RankingRetencaoPreview";

export default function RankingRetencaoPreviewPage() {
  if (process.env.VERCEL_ENV === "production") notFound();
  return <RankingRetencaoPreview />;
}
