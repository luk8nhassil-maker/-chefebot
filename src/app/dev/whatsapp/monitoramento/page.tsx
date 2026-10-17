import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifyToken } from "@/lib/auth";
import MonitorWhatsappClient from "./MonitorWhatsappClient";

export default async function MonitorWhatsappPage() {
  const token = (await cookies()).get("auth-token")?.value;
  const user = token ? await verifyToken(token) : null;
  if (!user || user.role !== "dev") redirect("/login");
  return <MonitorWhatsappClient />;
}
