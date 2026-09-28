import { headers } from "next/headers";
import { notFound } from "next/navigation";
import CofreChefePreview from "./CofreChefePreview";

export default async function CofreChefePreviewPage() {
  await headers();
  if (process.env.NODE_ENV !== "development" && process.env.VERCEL_ENV !== "preview") notFound();
  return <CofreChefePreview />;
}
