import { useEffect, useState } from "react";
import { useAIModels } from "./use-ai";
import { reportErrorOnce } from "@/lib/reportError";
import type { ConnectionStatus } from "@/lib/workspaceUtils";

export function useConnectionStatus() {
  const [aiStatus, setAiStatus] = useState<ConnectionStatus>("checking");
  const [cliStatus, setCliStatus] = useState<ConnectionStatus>("checking");
  const aiModels = useAIModels();

  useEffect(() => {
    if (aiModels.isLoading) setAiStatus("checking");
    else if (aiModels.isError) setAiStatus("disconnected");
    else if (aiModels.data) setAiStatus("connected");
  }, [aiModels.data, aiModels.isError, aiModels.isLoading]);

  useEffect(() => {
    const checkCli = async () => {
      try {
        const res = await fetch("/api/freqtrade/version", { credentials: "include" });
        if (!res.ok) {
          setCliStatus("disconnected");
          return;
        }
        const data = await res.json().catch(() => null);
        setCliStatus(data?.ok ? "connected" : "disconnected");
      } catch {
        reportErrorOnce("workspace:cliStatus", "CLI connection check failed", new Error("Failed to reach /api/freqtrade/version"), { showToast: false });
        setCliStatus("disconnected");
      }
    };

    checkCli();
    const interval = window.setInterval(checkCli, 30000);
    return () => window.clearInterval(interval);
  }, []);

  return { aiStatus, cliStatus };
}
