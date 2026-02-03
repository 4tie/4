import { useMemo, useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useBacktests } from "@/hooks/use-backtests";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DiagnosticReportView } from "@/components/diagnostic/DiagnosticReportView";
import { AIActionTimeline } from "@/components/ai/AIActionTimeline";
import { Badge } from "@/components/ui/badge";

type DiagnosticsPageProps = {
  selectedStrategyName?: string | null;
  placement: "header" | "sidebar";
  onPlacementChange: (next: "header" | "sidebar") => void;
  onOpenChat: () => void;
};

export function DiagnosticsPage({
  selectedStrategyName,
  placement,
  onPlacementChange,
  onOpenChat,
}: DiagnosticsPageProps) {
  const { data: backtests } = useBacktests();
  const completedBacktests = (backtests || []).filter((b: any) => String(b.status) === "completed");
  const filteredBacktests = selectedStrategyName
    ? completedBacktests.filter((b: any) => b.strategyName === selectedStrategyName)
    : completedBacktests;

  const [selectedBacktestId, setSelectedBacktestId] = useState<number | null>(() => {
    const latest = filteredBacktests[0];
    return latest?.id ?? null;
  });

  useEffect(() => {
    if (selectedBacktestId == null && filteredBacktests.length > 0) {
      setSelectedBacktestId(filteredBacktests[0].id);
    }
  }, [filteredBacktests, selectedBacktestId]);

  useEffect(() => {
    if (!selectedStrategyName) return;
    const first = filteredBacktests[0];
    if (first && first.id !== selectedBacktestId) {
      setSelectedBacktestId(first.id);
    }
  }, [selectedStrategyName, filteredBacktests, selectedBacktestId]);

  const selectedBacktest = useMemo(() => {
    if (!selectedBacktestId) return null;
    return filteredBacktests.find((b: any) => b.id === selectedBacktestId) || null;
  }, [filteredBacktests, selectedBacktestId]);

  const { data: jobs } = useQuery({
    queryKey: ["/api/diagnostic/jobs", selectedBacktestId],
    queryFn: async () => {
      const q = selectedBacktestId ? `?backtestId=${selectedBacktestId}` : "";
      const res = await fetch(`/api/diagnostic/jobs${q}`);
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 2000,
  });

  const { data: reports } = useQuery({
    queryKey: ["/api/diagnostic/reports", selectedBacktestId],
    queryFn: async () => {
      if (selectedBacktestId) {
        const res = await fetch(`/api/diagnostic/reports/${selectedBacktestId}`);
        if (!res.ok) return [];
        return res.json();
      }
      const res = await fetch("/api/diagnostic/reports");
      if (!res.ok) return [];
      return res.json();
    },
  });

  const latestReport = reports?.[0]?.report;

  const { data: aiActions } = useQuery({
    queryKey: ["/api/backtests/ai-actions", selectedBacktestId],
    enabled: Boolean(selectedBacktestId),
    queryFn: async () => {
      if (!selectedBacktestId) return [];
      const res = await fetch(`/api/backtests/${selectedBacktestId}/ai-actions`);
      if (!res.ok) return [];
      return res.json();
    },
  });

  const runDiagnosticMutation = useMutation({
    mutationFn: async () => {
      if (!selectedBacktestId) throw new Error("Select a backtest first");
      const res = await fetch("/api/diagnostic/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          backtestId: selectedBacktestId,
          strategyPath: selectedBacktest?.strategyName,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Failed to queue diagnostics");
      }
      return res.json();
    },
    onSuccess: async (data: any) => {
      const jobId = data?.jobId;
      if (selectedBacktestId) {
        await fetch("/api/ai-actions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            actionType: "diagnostic_run",
            description: `Diagnostics queued (job ${jobId})`,
            backtestId: selectedBacktestId,
          }),
        }).catch(() => {});
      }
    },
  });

  const handleAttachToChat = () => {
    if (!latestReport) return;
    const summary = latestReport?.summary;
    const text = [
      "Diagnostic Summary:",
      `- Verdict: ${summary?.statisticalVerdict || "-"}`,
      `- Primary Loss Driver: ${summary?.primaryLossDriver || "-"}`,
      `- Secondary Issue: ${summary?.secondaryIssue || "-"}`,
      `- Regime Failure: ${summary?.regimeFailure || "-"}`,
      `- Asset Risk: ${summary?.assetRisk || "-"}`,
      "",
      "Suggested Fixes:",
      ...(Array.isArray(summary?.suggestedFixes) ? summary.suggestedFixes.map((s: string) => `- ${s}`) : ["- None"]),
    ].join("\n");

    window.dispatchEvent(new CustomEvent("attach-diagnostic-summary", { detail: text }));
    onOpenChat();
  };

  const handleSendToFixDesign = async () => {
    if (!latestReport) return;
    const runId = (globalThis.crypto as any)?.randomUUID
      ? (globalThis.crypto as any).randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const envelope = {
      runId,
      agentId: "diagnostic",
      createdAt: new Date().toISOString(),
      inputs: {
        backtestId: selectedBacktestId,
        strategyPath: selectedBacktest?.strategyName,
      },
      artifacts: {
        diagnosticReportId: reports?.[0]?.id,
        diagnosticSummary: JSON.stringify(latestReport?.summary || {}),
        evidenceIndex: [],
        recommendedChangeTypes: latestReport?.phase11?.failureSignals?.recommendedChangeTypes || [],
      },
      aiActions: [],
      constraints: {
        productionSafe: true,
        maxLeverage: 1,
        allowLookAhead: false,
      },
      next: {
        recommendedNextAgent: "fix_design",
        questionsForNextAgent: [],
      },
    };

    await fetch("/api/agent-handoff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        runId,
        agentId: "diagnostic",
        envelope,
      }),
    }).catch(() => {});

    if (selectedBacktestId) {
      await fetch("/api/ai-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionType: "analysis",
          description: "Sent diagnostic report to Fix Design agent",
          backtestId: selectedBacktestId,
          results: { runId },
        }),
      }).catch(() => {});
    }
  };

  return (
    <div className="h-full flex flex-col gap-4 p-4 overflow-auto">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Diagnostics</h1>
          <p className="text-sm text-muted-foreground">Run diagnostics, track jobs, and review reports.</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">Placement: {placement}</Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPlacementChange(placement === "header" ? "sidebar" : "header")}
          >
            Preview {placement === "header" ? "Sidebar" : "Header"} Placement
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Select Backtest</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          <Select
            value={selectedBacktestId ? String(selectedBacktestId) : ""}
            onValueChange={(v) => setSelectedBacktestId(Number(v))}
          >
            <SelectTrigger className="w-[320px]">
              <SelectValue placeholder="Select a completed backtest" />
            </SelectTrigger>
            <SelectContent>
              {filteredBacktests.map((b: any) => (
                <SelectItem key={b.id} value={String(b.id)}>
                  {b.strategyName.split("/").pop()} (#{b.id})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            onClick={() => runDiagnosticMutation.mutate()}
            disabled={!selectedBacktestId || runDiagnosticMutation.isPending}
          >
            {runDiagnosticMutation.isPending ? "Queueing..." : "Run Diagnostic"}
          </Button>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Jobs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(jobs || []).length === 0 && <div className="text-sm text-muted-foreground">No jobs yet.</div>}
            {(jobs || []).map((job: any) => (
              <div key={job.id} className="p-2 rounded border border-border/40 bg-muted/40">
                <div className="flex items-center justify-between text-xs">
                  <span>Job {String(job.id).slice(0, 8)}</span>
                  <Badge variant="outline">{job.status}</Badge>
                </div>
                <div className="text-[10px] text-muted-foreground mt-1">
                  Phase: {job.progress?.currentPhase || "queued"} · {job.progress?.percent ?? 0}%
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Latest Report</CardTitle>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={handleAttachToChat} disabled={!latestReport}>
                Discuss in Chat
              </Button>
              <Button size="sm" variant="outline" onClick={handleSendToFixDesign} disabled={!latestReport}>
                Send to Fix Design Agent
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {latestReport ? (
              <DiagnosticReportView report={latestReport} />
            ) : (
              <div className="text-sm text-muted-foreground">No diagnostic reports yet.</div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>AI Action Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          {Array.isArray(aiActions) && aiActions.length > 0 ? (
            <AIActionTimeline actions={aiActions} />
          ) : (
            <div className="text-sm text-muted-foreground">No AI actions logged yet.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
