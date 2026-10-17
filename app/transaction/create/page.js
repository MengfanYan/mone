import Workspace from "@/components/workspace";
export default function Page() {
  return (
    <Workspace
      initialTab="ledger"
      demo={process.env.WALLET_UI_MODE === "demo"}
    />
  );
}
