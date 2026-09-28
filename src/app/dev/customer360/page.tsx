import { headers } from "next/headers";
import { notFound } from "next/navigation";
import Customer360Preview from "./Customer360Preview";

export default async function Customer360PreviewPage() {
  await headers();
  if (process.env.NODE_ENV !== "development" && process.env.VERCEL_ENV !== "preview") notFound();
  return <Customer360Preview />;
}
