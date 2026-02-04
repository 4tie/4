import { Fragment, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useFiles } from "@/hooks/use-files";
import { useGetConfig } from "@/hooks/use-config";
import { useAIModels, useResolvedAIModel, useAIStore } from "@/hooks/use-ai";

function statusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  const s = String(status || "").toLowerCase();
  if (s === "running") return "default";
  if (s === "queued") return "secondary";
  if (s === "completed") return "outline";
  if (s === "failed") return "destructive";
  if (s === "stopped") return "destructive";
  return "secondary";
}

function fmtNum(value: unknown, digits = 2): string {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return "-";
  return n.toFixed(digits);
}

export function RefinementLoopPage({ selectedStrategyPath }: { selectedStrategyPath?: string | null }) {
  const queryClient = useQueryClient();
  const { data: files } = useFiles();
  const { data: configData } = useGetConfig();
  const resolvedModel = useResolvedAIModel();
  const { data: models } = useAIModels();
  const { selectedModel, setSelectedModel } = useAIStore();

  const [expandedIterationIds, setExpandedIterationIds] = useState<Record<string, boolean>>({});

  const strategyFiles = useMemo(() => {
    const all = Array.isArray(files) ? files : [];
    return all
      .filter((f: any) => typeof f?.path === "string")
      .filter((f: any) => String(f.path).startsWith("user_data/strategies/") && String(f.path).endsWith(".py"))
      .map((f: any) => ({ path: String(f.path), name: String(f.path).split("/").pop() || String(f.path) }));
  }, [files]);

  const defaultStrategy = useMemo(() => {
    if (selectedStrategyPath && selectedStrategyPath.startsWith("user_data/strategies/") && selectedStrategyPath.endsWith(".py")) {
      return selectedStrategyPath;
    }
    return strategyFiles[0]?.path ?? "";
  }, [selectedStrategyPath, strategyFiles]);

  const [strategyPath, setStrategyPath] = useState<string>(defaultStrategy);
  const [maxIterations, setMaxIterations] = useState<string>("6");
  const [windowDays, setWindowDays] = useState<string>("30");
  const [stepDays, setStepDays] = useState<string>("30");
  const [count, setCount] = useState<string>("4");

  const [timeframe, setTimeframe] = useState<string>(() => String((configData as any)?.timeframe || "5m"));
  const [stakeAmount, setStakeAmount] = useState<string>(() => {
    const v = (configData as any)?.dry_run_wallet;
    return typeof v === "number" && Number.isFinite(v) ? String(v) : "50";
  });

  useEffect(() => {
    if (!defaultStrategy) return;
    setStrategyPath((prev) => (prev && prev.trim() ? prev : defaultStrategy));
  }, [defaultStrategy]);

  useEffect(() => {
    if (resolvedModel && resolvedModel !== selectedModel) {
      setSelectedModel(resolvedModel);
    }
  }, [resolvedModel, selectedModel, setSelectedModel]);

  const runsQuery = useQuery({
    queryKey: [api.refinement.runs.path],
    queryFn: async () => {
      const res = await fetch(api.refinement.runs.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load runs");
      return (await res.json()) as any[];
    },
    refetchInterval: 2000,
  });

  const [selectedRunId, setSelectedRunId] = useState<string>("");

  const runQuery = useQuery({
    queryKey: [api.refinement.run.path, selectedRunId],
    enabled: Boolean(selectedRunId),
    queryFn: async () => {
      const url = buildUrl(api.refinement.run.path, { runId: selectedRunId });
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load run");
      return (await res.json()) as any;
    },
    refetchInterval: 1500,
  });

  const startMutation = useMutation({
    mutationFn: async () => {
      const w = Number(windowDays);
      const s = Number(stepDays);
      const c = Number(count);
      const mi = Number(maxIterations);
      const stake = Number(stakeAmount);

      const payload = {
        strategyPath,
        baseConfig: {
          config: {
            timeframe,
            stake_amount: Number.isFinite(stake) ? stake : undefined,
          },
        },
        maxIterations: Number.isFinite(mi) ? Math.max(1, Math.min(8, Math.floor(mi))) : 6,
        rolling: {
          windowDays: Number.isFinite(w) ? Math.max(1, Math.floor(w)) : 30,
          stepDays: Number.isFinite(s) ? Math.max(1, Math.floor(s)) : 30,
          count: Number.isFinite(c) ? Math.max(1, Math.min(12, Math.floor(c))) : 4,
        },
        model: selectedModel || resolvedModel,
      };

      const res = await fetch(api.refinement.start.path, {
        method: api.refinement.start.method,
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as any)?.message || "Failed to start refinement");
      }

      return data as any;
    },
    onSuccess: async (data: any) => {
      const runId = String(data?.runId || "");
      if (runId) setSelectedRunId(runId);
      await queryClient.invalidateQueries({ queryKey: [api.refinement.runs.path] }).catch(() => {});
    },
  });

  const stopMutation = useMutation({
    mutationFn: async () => {
      const url = buildUrl(api.refinement.stop.path, { runId: selectedRunId });
      const res = await fetch(url, { method: api.refinement.stop.method, credentials: "include" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as any)?.message || "Failed to stop run");
      }
      return res.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [api.refinement.run.path, selectedRunId] }).catch(() => {});
      await queryClient.invalidateQueries({ queryKey: [api.refinement.runs.path] }).catch(() => {});
    },
  });

  const resumeMutation = useMutation({
    mutationFn: async () => {
      const url = buildUrl(api.refinement.resume.path, { runId: selectedRunId });
      const res = await fetch(url, { method: api.refinement.resume.method, credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as any)?.message || "Failed to resume run");
      return data as any;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [api.refinement.run.path, selectedRunId] }).catch(() => {});
      await queryClient.invalidateQueries({ queryKey: [api.refinement.runs.path] }).catch(() => {});
    },
  });

  const rerunBaselineMutation = useMutation({
    mutationFn: async () => {
      const url = buildUrl(api.refinement.rerunBaseline.path, { runId: selectedRunId });
      const res = await fetch(url, { method: api.refinement.rerunBaseline.method, credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as any)?.message || "Failed to rerun baseline");
      return data as any;
    },
    onSuccess: async (data: any) => {
      const runId = String(data?.runId || "");
      if (runId) setSelectedRunId(runId);
      await queryClient.invalidateQueries({ queryKey: [api.refinement.runs.path] }).catch(() => {});
      await queryClient.invalidateQueries({ queryKey: [api.refinement.run.path, runId || selectedRunId] }).catch(() => {});
    },
  });

  const activeRun = runQuery.data;
  const status = String(activeRun?.status || "");
  const progress = activeRun?.progress as any;
  const canStop = status === "running";
  const canResume = Boolean(selectedRunId) && status !== "running" && status !== "queued" && status !== "completed";
  const canRerunBaseline = Boolean(selectedRunId) && status !== "running" && status !== "queued";

  const toggleIterationExpanded = (iterationId: unknown) => {
    const key = String(iterationId ?? "");
    if (!key) return;
    setExpandedIterationIds((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const safeJson = (value: any) => {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  };

  return (
    <div className="p-4 space-y-4 overflow-auto h-full">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">AI Refinement Loop</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Strategy</Label>
              <Select value={strategyPath} onValueChange={(v) => setStrategyPath(v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select strategy" />
                </SelectTrigger>
                <SelectContent>
                  {strategyFiles.map((s) => (
                    <SelectItem key={s.path} value={s.path}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Model</Label>
              <Select value={selectedModel || resolvedModel} onValueChange={(v) => setSelectedModel(v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select model" />
                </SelectTrigger>
                <SelectContent>
                  {(models || []).map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Timeframe</Label>
              <Input value={timeframe} onChange={(e) => setTimeframe(e.target.value)} placeholder="5m" />
            </div>

            <div className="space-y-2">
              <Label>Stake amount</Label>
              <Input value={stakeAmount} onChange={(e) => setStakeAmount(e.target.value)} placeholder="50" />
            </div>

            <div className="space-y-2">
              <Label>Iterations (max 8)</Label>
              <Input value={maxIterations} onChange={(e) => setMaxIterations(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>Rolling windows (count / windowDays / stepDays)</Label>
              <div className="grid grid-cols-3 gap-2">
                <Input value={count} onChange={(e) => setCount(e.target.value)} />
                <Input value={windowDays} onChange={(e) => setWindowDays(e.target.value)} />
                <Input value={stepDays} onChange={(e) => setStepDays(e.target.value)} />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              onClick={() => startMutation.mutate()}
              disabled={!strategyPath || startMutation.isPending}
            >
              Start
            </Button>
            {startMutation.error ? (
              <Alert variant="destructive" className="flex-1">
                <AlertTitle>Start failed</AlertTitle>
                <AlertDescription>{String((startMutation.error as any)?.message || startMutation.error)}</AlertDescription>
              </Alert>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Runs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {runsQuery.error ? (
            <Alert variant="destructive">
              <AlertTitle>Failed to load runs</AlertTitle>
              <AlertDescription>{String((runsQuery.error as any)?.message || runsQuery.error)}</AlertDescription>
            </Alert>
          ) : null}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Run</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Strategy</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(runsQuery.data || []).slice(0, 20).map((r: any) => (
                <TableRow
                  key={String(r.id)}
                  className={String(r.id) === selectedRunId ? "bg-muted/40" : "cursor-pointer"}
                  onClick={() => setSelectedRunId(String(r.id))}
                >
                  <TableCell className="font-mono text-xs">{String(r.id).slice(0, 8)}</TableCell>
                  <TableCell>
                    <Badge variant={statusBadgeVariant(String(r.status))}>{String(r.status)}</Badge>
                  </TableCell>
                  <TableCell className="text-xs">{String(r.strategyPath || "-").split("/").pop()}</TableCell>
                  <TableCell className="text-xs">{r.updatedAt ? new Date(r.updatedAt).toLocaleString() : "-"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {activeRun ? (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-sm">Run Details</CardTitle>
              <div className="flex items-center gap-2">
                <Badge variant={statusBadgeVariant(status)}>{status || "-"}</Badge>
                {canStop ? (
                  <Button variant="destructive" size="sm" onClick={() => stopMutation.mutate()} disabled={stopMutation.isPending}>
                    Stop
                  </Button>
                ) : null}
                {canResume ? (
                  <Button variant="outline" size="sm" onClick={() => resumeMutation.mutate()} disabled={resumeMutation.isPending}>
                    Resume
                  </Button>
                ) : null}
                {canRerunBaseline ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => rerunBaselineMutation.mutate()}
                    disabled={rerunBaselineMutation.isPending}
                  >
                    Rerun baseline
                  </Button>
                ) : null}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-xs text-muted-foreground">
              Iteration: {progress?.iteration ?? "-"} | Stage: {progress?.stage ?? "-"} | Step: {progress?.step ?? "-"} | {progress?.percent != null ? `Progress: ${fmtNum(progress.percent, 0)}%` : ""}
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Iter</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Decision</TableHead>
                  <TableHead>Median Profit %</TableHead>
                  <TableHead>Worst DD %</TableHead>
                  <TableHead>Trades/day</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(activeRun.iterations || []).map((it: any) => {
                  const iterationKey = String(it.id);
                  const expanded = Boolean(expandedIterationIds[iterationKey]);
                  const proposed = it.proposed;
                  const validation = it.validation;
                  const applied = it.applied;

                  const strategyDiff =
                    (typeof validation?.diff === "string" && validation.diff.trim() ? validation.diff : null) ??
                    (typeof applied?.diff === "string" && applied.diff.trim() ? applied.diff : null);

                  const configDiff = typeof applied?.configDiff === "string" && applied.configDiff.trim() ? applied.configDiff : null;
                  const configPatch = proposed?.type === "config_patch" ? proposed?.patch : applied?.patch;

                  const hasDetails = Boolean(strategyDiff || configDiff || configPatch);

                  return (
                    <Fragment key={iterationKey}>
                      <TableRow>
                        <TableCell className="text-xs">{it.iteration}</TableCell>
                        <TableCell className="text-xs">{String(it.stage || "-")}</TableCell>
                        <TableCell className="text-xs">{String(it.decision || "-")}</TableCell>
                        <TableCell className="text-xs">{it.metrics ? fmtNum(it.metrics.medianProfitPct, 2) : "-"}</TableCell>
                        <TableCell className="text-xs">{it.metrics ? fmtNum(it.metrics.worstDrawdownPct, 2) : "-"}</TableCell>
                        <TableCell className="text-xs">{it.metrics ? fmtNum(it.metrics.avgTradesPerDay, 2) : "-"}</TableCell>
                        <TableCell className="text-xs">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-[11px]"
                            disabled={!hasDetails}
                            onClick={() => toggleIterationExpanded(it.id)}
                          >
                            {expanded ? "Hide" : "Show"}
                          </Button>
                        </TableCell>
                      </TableRow>

                      {expanded ? (
                        <TableRow className="bg-muted/20">
                          <TableCell colSpan={7}>
                            <div className="space-y-3 py-2">
                              {strategyDiff ? (
                                <div>
                                  <div className="text-xs font-medium">Strategy diff</div>
                                  <pre className="mt-1 max-h-[320px] overflow-auto rounded-md border bg-background p-2 text-[11px] leading-relaxed">
                                    {strategyDiff}
                                  </pre>
                                </div>
                              ) : null}

                              {configDiff ? (
                                <div>
                                  <div className="text-xs font-medium">Config diff</div>
                                  <pre className="mt-1 max-h-[320px] overflow-auto rounded-md border bg-background p-2 text-[11px] leading-relaxed">
                                    {configDiff}
                                  </pre>
                                </div>
                              ) : null}

                              {configPatch ? (
                                <div>
                                  <div className="text-xs font-medium">Config patch</div>
                                  <pre className="mt-1 max-h-[220px] overflow-auto rounded-md border bg-background p-2 text-[11px] leading-relaxed">
                                    {safeJson(configPatch)}
                                  </pre>
                                </div>
                              ) : null}
                            </div>
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>

            {runQuery.error ? (
              <Alert variant="destructive">
                <AlertTitle>Failed to load run</AlertTitle>
                <AlertDescription>{String((runQuery.error as any)?.message || runQuery.error)}</AlertDescription>
              </Alert>
            ) : null}

            {resumeMutation.error ? (
              <Alert variant="destructive">
                <AlertTitle>Resume failed</AlertTitle>
                <AlertDescription>{String((resumeMutation.error as any)?.message || resumeMutation.error)}</AlertDescription>
              </Alert>
            ) : null}

            {rerunBaselineMutation.error ? (
              <Alert variant="destructive">
                <AlertTitle>Rerun baseline failed</AlertTitle>
                <AlertDescription>{String((rerunBaselineMutation.error as any)?.message || rerunBaselineMutation.error)}</AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
