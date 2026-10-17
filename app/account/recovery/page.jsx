import { notFound } from "next/navigation";
import CloudRecovery from "@/components/cloud-recovery";
export default function Page() {
  if (process.env.WALLET_UI_MODE !== "cloud") notFound();
  return <CloudRecovery />;
}
