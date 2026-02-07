import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";

import { CodeEditor, type CodeEditorHandle, type EditorState } from "@/components/Editor";
import { ChatPanel } from "@/components/ChatPanel";
import { WorkspaceHeader } from "@/components/workspace/WorkspaceHeader";
import { StrategySidebar } from "@/components/workspace/StrategySidebar";
import { CenterPanel } from "@/components/workspace/CenterPanel";
import { TradesTable } from "@/components/workspace/TradesTable";
import { StrategyValidationDialog } from "@/components/diagnostic/StrategyValidationDialog";

import { useFiles, useFile, useUpdateFile } from "@/hooks/use-files";
import { useWorkspaceTheme } from "@/hooks/use-workspace-theme";
import { useQuickBacktest } from "@/hooks/use-quick-backtest";
import { useConnectionStatus } from "@/hooks/use-connection-status";
import { useTradeResults } from "@/hooks/use-trade-results";
import { useUpdateConfig } from "@/hooks/use-config";

import { api } from "@shared/routes";
import { reportError } from "@/lib/reportError";
import { validateStrategy } from "@/lib/strategyValidation";

export default function DarkWorkspace() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  
  // Theme
  useWorkspaceTheme();

  // Chat panel state
  const [chatOpen, setChatOpen] = useState(true);
  const [chatOverlayDismissed, setChatOverlayDismissed] = useState(false);
  const chatPanelRef = useRef<any>(null);

  // Files
  const { data: files, isLoading: filesLoading } = useFiles();
  const [search, setSearch] = useState("");
  
  const strategies = useMemo(() => {
    const arr = Array.isArray(files) ? files : [];
    const filtered = arr.filter((f) => typeof f?.path === "string" && f.path.startsWith("user_data/strategies/") && f.path.endsWith(".py"));
    const q = search.trim().toLowerCase();
    const out = q
      ? filtered.filter((f) => String(f.path).toLowerCase().includes(q) || String(f.path).split("/").pop()?.toLowerCase().includes(q))
      : filtered;
    return out.sort((a: any, b: any) => String(a.path).localeCompare(String(b.path)));
  }, [files, search]);

  // Active file
  const [activeFileId, setActiveFileId] = useState<number | null>(null);
  const { data: activeFile } = useFile(activeFileId);
  const updateFile = useUpdateFile();
  const updateConfig = useUpdateConfig();

  const activeFilePath = typeof (activeFile as any)?.path === "string" ? String((activeFile as any).path) : "";
  const isStrategyFile = Boolean(activeFilePath && activeFilePath.startsWith("user_data/strategies/") && activeFilePath.endsWith(".py"));

  // Editor state
  const [editorContent, setEditorContent] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const editorRef = useRef<CodeEditorHandle>(null);
  const [editorState, setEditorState] = useState<EditorState>({ selectedCode: "", lineNumber: 1, columnNumber: 1 });

  useEffect(() => {
    if (!activeFile) return;
    setEditorContent((activeFile as any).content ?? "");
    setIsDirty(false);
  }, [activeFile]);

  const handleSelectFile = (id: number) => {
    if (isDirty) {
      const ok = confirm("You have unsaved changes. Discard them?");
      if (!ok) return;
    }
    setActiveFileId(id);
  };

  const handleSave = useCallback(
    async (value?: string) => {
      if (!activeFileId) return;
      const content = typeof value === "string" ? value : editorRef.current?.getValue?.() ?? editorContent;
      await updateFile.mutateAsync({ id: activeFileId, content });
      setEditorContent(content);
      setIsDirty(false);
    },
    [activeFileId, editorContent, updateFile],
  );

  // Connection status
  const { aiStatus, cliStatus } = useConnectionStatus();

  // Validation dialog state
  const [validationOpen, setValidationOpen] = useState(false);

  const [inlineEditsEnabled, setInlineEditsEnabled] = useState(false);

  const handleValidate = useCallback(async () => {
    if (!isStrategyFile || !activeFilePath) return;
    setValidationOpen(true);
  }, [isStrategyFile, activeFilePath]);

  useEffect(() => {
    if (!isStrategyFile) {
      setInlineEditsEnabled(false);
    }
  }, [isStrategyFile]);

  // Quick backtest
  const quickBacktest = useQuickBacktest();

  // Available pairs from config
  const availablePairs = useMemo(() => {
    const exchangePairs = (quickBacktest.configData as any)?.exchange?.pair_whitelist;
    const pairlistPairs = (quickBacktest.configData as any)?.pairlists?.[0]?.pair_whitelist;

    const fromConfig = [exchangePairs, pairlistPairs]
      .flatMap((p: any) => (Array.isArray(p) ? p : []))
      .map((p: any) => String(p))
      .filter((p: string) => p.trim().length > 0);

    const seen = new Set<string>();
    const merged: string[] = [];
    for (const p of fromConfig) {
      if (seen.has(p)) continue;
      seen.add(p);
      merged.push(p);
    }

    return merged;
  }, [quickBacktest.configData]);

  const filteredPairs = useMemo(() => {
    const q = quickBacktest.pairsQuery.trim().toLowerCase();
    if (!q) return availablePairs;
    return availablePairs.filter((p) => p.toLowerCase().includes(q));
  }, [availablePairs, quickBacktest.pairsQuery]);

  // Trade results
  const tradeResults = useTradeResults(activeFilePath, activeFileId, isDirty, activeFile);

  // Set diff state when active file changes (only when ID actually changes)
  useEffect(() => {
    tradeResults.setDiffState(null);
    tradeResults.setCenterMode("code");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFileId]);

  // Apply code from chat
  const handleApplyCode = useCallback((code: string) => {
    editorRef.current?.applyCode(code);
    setEditorContent(editorRef.current?.getValue?.() ?? editorContent);
    setIsDirty(true);
  }, [editorContent]);

  const handleApplyAndSaveCode = useCallback((code: string) => {
    editorRef.current?.applyCode(code);
    const next = editorRef.current?.getValue?.() ?? editorContent;
    setEditorContent(next);
    setIsDirty(true);
    handleSave(next).catch((e) => {
      reportError("Save failed", e);
    });
  }, [editorContent, handleSave]);

  // Handle run backtest
  const handleRunQuickBacktest = async () => {
    const id = await quickBacktest.handleRunQuickBacktest(activeFilePath, isStrategyFile);
    if (id != null) {
      tradeResults.setLastBacktestId(id);
    }
  };

  // Navigation back
  const handleNavigateBack = () => {
    if (isDirty) {
      const ok = confirm("You have unsaved changes. Leave anyway?");
      if (!ok) return;
    }
    navigate("/");
  };

  return (
    <div
      className="h-[100dvh] w-full overflow-hidden bg-gradient-to-br from-[#05040a] via-[#0b0714] to-[#12061e] text-slate-100"
      style={{ paddingBottom: "var(--workspace-safe-bottom, 0px)" }}
    >
      <WorkspaceHeader
        activeFilePath={activeFilePath}
        isDirty={isDirty}
        isSaving={updateFile.isPending}
        isStrategyFile={isStrategyFile}
        isRunningBacktest={quickBacktest.isRunningBacktest}
        aiStatus={aiStatus}
        cliStatus={cliStatus}
        onNavigateBack={handleNavigateBack}
        onSave={handleSave}
        onValidate={handleValidate}
        inlineEditsEnabled={inlineEditsEnabled}
        onToggleInlineEdits={() => setInlineEditsEnabled((v) => !v)}
        onRunBacktest={() => {
          quickBacktest.setQuickConfigTouched(true);
          handleRunQuickBacktest().catch((e) => {
            reportError("Quick backtest failed", e);
          });
        }}
      />

      <StrategyValidationDialog
        open={validationOpen}
        onOpenChange={setValidationOpen}
        originalCode={editorContent}
        strategyName={activeFilePath}
        onValidate={() =>
          validateStrategy({
            strategyName: activeFilePath,
            code: editorContent,
            config: (quickBacktest.configData && typeof quickBacktest.configData === "object" ? quickBacktest.configData : undefined) as any,
          })
        }
        onPreviewEdits={async ({ strategyPath, edits }) => {
          const res = await fetch(api.strategies.edit.path, {
            method: api.strategies.edit.method,
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ strategyPath, edits, dryRun: true }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            const msg = typeof (data as any)?.message === "string" ? String((data as any).message) : "Rejected change(s)";
            const details = typeof (data as any)?.details === "string" ? String((data as any).details) : "";
            throw new Error(details ? `${msg}: ${details}` : msg);
          }
          return data;
        }}
        onApplyToEditor={async (code: string) => {
          editorRef.current?.applyCode(code);
          const next = editorRef.current?.getValue?.() ?? code;
          setEditorContent(next);
          setIsDirty(true);
        }}
        onApplyEditsAndSave={async ({ strategyPath, edits }) => {
          const res = await fetch(api.strategies.edit.path, {
            method: api.strategies.edit.method,
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ strategyPath, edits, dryRun: false }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            const msg = typeof (data as any)?.message === "string" ? String((data as any).message) : "Rejected change(s)";
            const details = typeof (data as any)?.details === "string" ? String((data as any).details) : "";
            throw new Error(details ? `${msg}: ${details}` : msg);
          }
          await queryClient.invalidateQueries({ queryKey: [api.files.list.path] });
          await queryClient.invalidateQueries({ queryKey: [api.files.getByPath.path, strategyPath] });
          if (activeFileId) {
            await queryClient.invalidateQueries({ queryKey: [api.files.get.path, activeFileId] });
          }
        }}
        onMarkValidation={async ({ validationId, applied, saved }) => {
          const res = await fetch("/api/diagnostics/changes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ id: validationId, applied: Boolean(applied), saved: Boolean(saved) }),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(typeof (data as any)?.message === "string" ? String((data as any).message) : "Failed to update validation state");
          }
        }}
      />

      <ResizablePanelGroup
        direction="horizontal"
        style={{ height: "calc(100dvh - 3rem - var(--workspace-safe-bottom, 0px))" }}
      >
        <ResizablePanel defaultSize={22} minSize={16} className="bg-black/25">
          <StrategySidebar
            filesLoading={filesLoading}
            strategies={strategies}
            activeFileId={activeFileId}
            search={search}
            setSearch={setSearch}
            onSelectFile={handleSelectFile}
            quickTimeframe={quickBacktest.quickTimeframe}
            setQuickTimeframe={quickBacktest.setQuickTimeframe}
            quickTimerangePreset={quickBacktest.quickTimerangePreset}
            setQuickTimerangePreset={quickBacktest.setQuickTimerangePreset}
            quickTimerange={quickBacktest.quickTimerange}
            setQuickTimerange={quickBacktest.setQuickTimerange}
            quickSelectedPairs={quickBacktest.quickSelectedPairs}
            setQuickSelectedPairs={quickBacktest.setQuickSelectedPairs}
            pairsOpen={quickBacktest.pairsOpen}
            setPairsOpen={quickBacktest.setPairsOpen}
            pairsQuery={quickBacktest.pairsQuery}
            setPairsQuery={quickBacktest.setPairsQuery}
            quickStake={quickBacktest.quickStake}
            setQuickStake={quickBacktest.setQuickStake}
            quickMaxOpenTrades={quickBacktest.quickMaxOpenTrades}
            setQuickMaxOpenTrades={quickBacktest.setQuickMaxOpenTrades}
            maxTradesMode={quickBacktest.maxTradesMode}
            setMaxTradesMode={quickBacktest.setMaxTradesMode}
            maxTradesUserSet={quickBacktest.maxTradesUserSet}
            setMaxTradesUserSet={quickBacktest.setMaxTradesUserSet}
            availablePairs={availablePairs}
            filteredPairs={filteredPairs}
            downloadStatus={quickBacktest.downloadStatus}
            downloadLog={quickBacktest.downloadLog}
            onClearDownloadLog={quickBacktest.clearDownloadLog}
            lastBacktestId={tradeResults.lastBacktestId}
            isDownloading={quickBacktest.isDownloading}
            toggleQuickPair={quickBacktest.toggleQuickPair}
            selectAllQuickPairs={() => quickBacktest.selectAllQuickPairs(availablePairs)}
            clearQuickPairs={quickBacktest.clearQuickPairs}
            handleTimerangePresetChange={quickBacktest.handleTimerangePresetChange}
            handleDownloadData={quickBacktest.handleDownloadData}
            setQuickConfigTouched={quickBacktest.setQuickConfigTouched}
          />
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel defaultSize={53} minSize={30} className="bg-black/10">
          <CenterPanel
            centerMode={tradeResults.centerMode}
            setCenterMode={tradeResults.setCenterMode}
            activeFileId={activeFileId}
            diffState={tradeResults.diffState}
            lastBacktest={tradeResults.lastBacktest}
            isBacktestLoading={tradeResults.isBacktestLoading}
            quickParams={{
              enabled: isStrategyFile && inlineEditsEnabled,
              timeframe: {
                value: quickBacktest.quickTimeframe,
                options: ["1m", "5m", "15m", "30m", "1h", "2h", "4h", "1d"],
                onChangeBacktest: (tf: string) => {
                  quickBacktest.setQuickConfigTouched(true);
                  const allowed = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;
                  const next = (allowed as readonly string[]).includes(tf) ? (tf as (typeof allowed)[number]) : "4h";
                  quickBacktest.setQuickTimeframe(next);
                },
              },
              timerange: {
                value: quickBacktest.quickTimerange,
                onChangeBacktest: (tr: string) => {
                  quickBacktest.setQuickConfigTouched(true);
                  quickBacktest.setQuickTimerange(String(tr || "").trim());
                },
              },
              stake: {
                value: Number(quickBacktest.quickStake ?? 0),
                onChangeBacktest: (stake: number) => {
                  quickBacktest.setQuickConfigTouched(true);
                  quickBacktest.setQuickStake(stake);
                },
              },
              maxOpenTrades: {
                value: Number(quickBacktest.quickMaxOpenTrades ?? 1),
                onChangeBacktest: (mot: number) => {
                  quickBacktest.setQuickConfigTouched(true);
                  quickBacktest.setMaxTradesUserSet(true);
                  quickBacktest.setQuickMaxOpenTrades(mot);
                },
              },
            }}
            editorContent={editorContent}
            setEditorContent={setEditorContent}
            setIsDirty={setIsDirty}
            onSave={handleSave}
            editorState={editorState}
            setEditorState={setEditorState}
            isDirty={isDirty}
            lastBacktestId={tradeResults.lastBacktestId}
          >
            <TradesTable
              allTrades={tradeResults.allTrades}
              tradePairs={tradeResults.tradePairs}
              tradePairCounts={tradeResults.tradePairCounts}
              filteredTrades={tradeResults.filteredTrades}
              pagedTrades={tradeResults.pagedTrades}
              filteredTradesTotals={tradeResults.filteredTradesTotals}
              resultsSummary={tradeResults.resultsSummary}
              backtestStatus={String((tradeResults.lastBacktest as any)?.status || "")}
              backtestError={typeof (tradeResults.lastBacktest as any)?.results?.error === "string" ? (tradeResults.lastBacktest as any).results.error : undefined}
              backtestLogTail={Array.isArray((tradeResults.lastBacktest as any)?.logs) ? (tradeResults.lastBacktest as any).logs.slice(-200).join("\n") : undefined}
              tradesViewTab={tradeResults.tradesViewTab}
              setTradesViewTab={tradeResults.setTradesViewTab}
              tradesFilterPair={tradeResults.tradesFilterPair}
              setTradesFilterPair={tradeResults.setTradesFilterPair}
              tradesFilterPnL={tradeResults.tradesFilterPnL}
              setTradesFilterPnL={tradeResults.setTradesFilterPnL}
              tradesSearch={tradeResults.tradesSearch}
              setTradesSearch={tradeResults.setTradesSearch}
              tradesPage={tradeResults.tradesPage}
              setTradesPage={tradeResults.setTradesPage}
              tradesPageSize={tradeResults.tradesPageSize}
              setTradesPageSize={tradeResults.setTradesPageSize}
              perPairSort={tradeResults.perPairSort}
              setPerPairSort={tradeResults.setPerPairSort}
              tradeColWidths={tradeResults.tradeColWidths}
              startResizeTradeCol={tradeResults.startResizeTradeCol}
              onSelectProfitablePairs={(pairs) => {
                quickBacktest.setQuickSelectedPairs(pairs);
                quickBacktest.setQuickConfigTouched(true);
              }}
            />
          </CenterPanel>
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel
          ref={chatPanelRef}
          collapsible
          collapsedSize={0}
          minSize={20}
          defaultSize={25}
          className="bg-black/25"
          onCollapse={() => {
            setChatOpen(false);
            setChatOverlayDismissed(true);
          }}
          onExpand={() => {
            setChatOpen(true);
          }}
        >
          <div className="h-full relative">
            <ChatPanel
              isOpen={chatOpen}
              onToggle={() => {
                setChatOpen((v) => {
                  const next = !v;
                  if (!next) setChatOverlayDismissed(true);
                  return next;
                });
              }}
              context={{
                fileName: isStrategyFile ? activeFilePath : undefined,
                fileContent: isStrategyFile ? editorContent : undefined,
                selectedCode: editorState.selectedCode,
                lineNumber: editorState.lineNumber,
                columnNumber: editorState.columnNumber,
                lastBacktest: tradeResults.lastBacktestId != null
                  ? {
                      id: tradeResults.lastBacktestId,
                      strategyName: activeFilePath,
                      config: (tradeResults.lastBacktest as any)?.config,
                      status: String((tradeResults.lastBacktest as any)?.status || ""),
                      error: typeof (tradeResults.lastBacktest as any)?.results?.error === "string" ? (tradeResults.lastBacktest as any).results.error : undefined,
                      logTail: Array.isArray((tradeResults.lastBacktest as any)?.logs)
                        ? (tradeResults.lastBacktest as any).logs.slice(-120).join("\n")
                        : undefined,
                    }
                  : undefined,
                backtestResults: tradeResults.resultsSummary
                  ? {
                      profit_total: tradeResults.resultsSummary.profitPct ?? 0,
                      win_rate: tradeResults.resultsSummary.winratePct ?? 0,
                      max_drawdown: tradeResults.resultsSummary.ddPct ?? 0,
                      total_trades: Number(tradeResults.resultsSummary.totalTrades ?? 0),
                      avg_profit: undefined,
                      sharpe: typeof tradeResults.resultsSummary.sharpe === "number" ? tradeResults.resultsSummary.sharpe : undefined,
                    }
                  : undefined,
              }}
              onApplyCode={handleApplyCode}
              onApplyConfig={async (patch) => {
                await updateConfig.mutateAsync(patch as any);
                quickBacktest.setQuickConfigTouched(true);
              }}
              onApplyAndSaveCode={handleApplyAndSaveCode}
              onPreviewValidatedEdit={tradeResults.onPreviewValidatedEdit}
            />
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
