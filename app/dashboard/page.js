import Workspace from "@/components/workspace";
export default function Page() {
  return (
    <Workspace
      cloud={process.env.WALLET_UI_MODE === "cloud"}
      demo={process.env.WALLET_UI_MODE === "demo"}
    />
  );
}
