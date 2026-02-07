import { useRef, useState, useEffect, type ReactNode } from "react";
import { DiffEditor } from "@monaco-editor/react";
import { FileCode, GitCompare, BarChart3, Loader2, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CodeEditor, type CodeEditorHandle, type EditorState } from "@/components/Editor";
import { cn } from "@/lib/utils";
import type { DiffState } from "@/lib/workspaceUtils";
import { useQuery } from "@tanstack/react-query";
import type { DiagnosticReport } from "@shared/schema";
import { DiagnosticReportView } from "@/components/diagnostic/DiagnosticReportView";

interface CenterPanelProps {
  centerMode: "code" | "diff" | "results" | "diagnostics";
  setCenterMode: (v: "code" | "diff" | "results" | "diagnostics") => void;
  activeFileId: number | null;
  diffState: DiffState | null;
  lastBacktest: unknown;
  isBacktestLoading?: boolean;
  lastBacktestId?: number | null;
  quickParams?: {
    enabled: boolean;
    timeframe?: {
      value: string;
      options: string[];
      onChangeBacktest?: (tf: string) => void;
    };
    timerange?: {
      value: string;
      onChangeBacktest?: (timerange: string) => void;
    };
    stake?: {
      value: number;
      onChangeBacktest?: (stake: number) => void;
    };
    maxOpenTrades?: {
      value: number;
      onChangeBacktest?: (maxOpenTrades: number) => void;
    };
  };
  editorContent: string;
  setEditorContent: (v: string) => void;
  setIsDirty: (dirty: boolean) => void;
  onSave: (value: string) => Promise<void>;
  editorState: EditorState;
  setEditorState: (s: EditorState) => void;
  isDirty: boolean;
  children?: ReactNode;
}

export function CenterPanel({
  centerMode,
  setCenterMode,
  activeFileId,
  diffState,
  lastBacktest,
  isBacktestLoading,
  quickParams,
  editorContent,
  setEditorContent,
  setIsDirty,
  onSave,
  editorState,
  setEditorState,
  isDirty,
  lastBacktestId,
  children,
}: CenterPanelProps) {
  const editorRef = useRef<CodeEditorHandle>(null);
  const [diffMounted, setDiffMounted] = useState(false);
  const diffEditorRef = useRef<string>(Math.random().toString(36).slice(2));
  const [diffEditorKey, setDiffEditorKey] = useState(0);

  useEffect(() => {
    if (centerMode === "diff" && diffState) {
      const timer = setTimeout(() => setDiffMounted(true), 50);
      return () => clearTimeout(timer);
    } else {
      setDiffMounted(false);
    }
  }, [centerMode, diffState]);

  useEffect(() => {
    if (centerMode === "diff" && diffState) {
      setDiffEditorKey((k) => k + 1);
    }
  }, [centerMode, diffState?.before, diffState?.after]);

  const { data: diagnosticReports, isLoading: isDiagnosticLoading } = useQuery<DiagnosticReport[]>({
    queryKey: [lastBacktestId ? `/api/diagnostic/reports/${lastBacktestId}` : ""],
    enabled: Boolean(lastBacktestId),
    refetchInterval: 3000,
  });

  const latestDiagnostic = diagnosticReports?.[0]?.report;

  return (
    <div className="h-full flex flex-col">
      <div className="h-10 border-b border-white/10 bg-black/20 flex items-center justify-between px-3">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-7 px-2 text-xs gap-2",
              centerMode === "code" ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5 hover:text-white",
            )}
            onClick={() => setCenterMode("code")}
            disabled={!activeFileId}
          >
            <FileCode className="w-3.5 h-3.5" />
            Code
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-7 px-2 text-xs gap-2",
              centerMode === "diff" ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5 hover:text-white",
            )}
            onClick={() => setCenterMode("diff")}
            disabled={!diffState}
          >
            <GitCompare className="w-3.5 h-3.5" />
            Diff
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-7 px-2 text-xs gap-2 transition-colors",
              centerMode === "results"
                ? "bg-gradient-to-r from-purple-600/30 to-red-600/30 text-white border border-white/10"
                : "text-slate-300 hover:bg-white/5 hover:text-white",
            )}
            onClick={() => setCenterMode("results")}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            Results
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-7 px-2 text-xs gap-2 transition-colors",
              centerMode === "diagnostics"
                ? "bg-gradient-to-r from-purple-600/30 to-red-600/30 text-white border border-white/10"
                : "text-slate-300 hover:bg-white/5 hover:text-white",
            )}
            onClick={() => setCenterMode("diagnostics")}
            disabled={!lastBacktestId}
          >
            <Activity className="w-3.5 h-3.5" />
            Diagnostics
          </Button>
        </div>

        <div className="flex items-center gap-2">
          {isDirty ? (
            <Badge variant="outline" className="border-red-500/30 bg-red-500/10 text-red-400 text-[10px]">
              Unsaved
            </Badge>
          ) : (
            <Badge variant="outline" className="border-white/10 bg-black/20 text-slate-300 text-[10px]">
              Clean
            </Badge>
          )}
          {diffState ? (
            <Badge variant="outline" className="border-purple-500/30 bg-purple-500/10 text-purple-200 text-[10px]">
              Validated
            </Badge>
          ) : null}
        </div>
      </div>

      <div className="flex-1 min-h-0 p-3">
        {centerMode === "diff" ? (
          diffState ? (
            <div className="h-full rounded-md border border-white/10 overflow-hidden">
              {diffMounted && (
                <DiffEditor
                  key="diff-editor-stable"
                  height="100%"
                  language="python"
                  theme="vs-dark"
                  original={diffState.before}
                  modified={diffState.after}
                  originalModelPath={`inmemory://centerpanel/${diffEditorRef.current}/diff/${diffEditorKey}/original.py`}
                  modifiedModelPath={`inmemory://centerpanel/${diffEditorRef.current}/diff/${diffEditorKey}/modified.py`}
                  options={{
                    readOnly: true,
                    renderSideBySide: true,
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    fontSize: 13,
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                />
              )}
            </div>
          ) : (
            <div className="h-full rounded-md border border-white/10 bg-black/20 flex items-center justify-center text-xs text-slate-400">
              No validated diff yet.
            </div>
          )
        ) : centerMode === "diagnostics" ? (
          <div className="h-full rounded-md border border-white/10 bg-black/20 overflow-hidden flex flex-col">
            <div className="px-3 py-2 border-b border-white/10 bg-black/30 text-xs text-slate-300">
              Latest diagnostics
            </div>
            {isDiagnosticLoading ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-2">
                <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
                <div className="text-xs text-slate-400">Loading diagnostics...</div>
              </div>
            ) : latestDiagnostic ? (
              <ScrollArea className="flex-1">
                <div className="p-3">
                  <DiagnosticReportView report={latestDiagnostic} />
                </div>
              </ScrollArea>
            ) : (
              <div className="flex-1 flex items-center justify-center text-xs text-slate-400">
                No diagnostic report yet. Queue a diagnostic run to see explanations here.
              </div>
            )}
          </div>
        ) : centerMode === "results" ? (
          isBacktestLoading ? (
            <div className="h-full rounded-md border border-white/10 bg-black/20 flex flex-col items-center justify-center gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
              <div className="text-xs text-slate-400">Loading backtest results...</div>
            </div>
          ) : lastBacktest ? (
            <div className="h-full rounded-md border border-white/10 bg-black/20 overflow-hidden flex flex-col">
              {children}
            </div>
          ) : lastBacktestId ? (
            <div className="h-full rounded-md border border-white/10 bg-black/20 flex flex-col items-center justify-center gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
              <div className="text-xs text-slate-400">Fetching backtest #{lastBacktestId}...</div>
            </div>
          ) : (
            <div className="h-full rounded-md border border-white/10 bg-black/20 flex items-center justify-center text-xs text-slate-400">
              Run a backtest to view results.
            </div>
          )
        ) : activeFileId ? (
          <CodeEditor
            ref={editorRef}
            language="python"
            value={editorContent}
            quickParams={quickParams}
            onChange={(v) => {
              if (v === undefined) return;
              setEditorContent(v);
              setIsDirty(true);
            }}
            onSave={onSave}
            onEditorStateChange={(s) => setEditorState(s)}
          />
        ) : (
          <div className="h-full rounded-md border border-white/10 bg-black/20 flex items-center justify-center text-xs text-slate-400">
            Select a strategy.
          </div>
        )}
      </div>
    </div>
  );
}
