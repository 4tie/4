import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { StrategyComparison } from "@/components/StrategyComparison";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Sidebar } from "@/components/Sidebar";
import { CodeEditor, type EditorState, type CodeEditorHandle } from "@/components/Editor";
import { TerminalPanel } from "@/components/TerminalPanel";
import { BacktestDashboard } from "@/components/BacktestDashboard";
import { ChatPanel, ChatToggleButton } from "@/components/ChatPanel";
import { BacktestResults } from "@/components/BacktestResults";
import { StrategyParamsDialog } from "@/components/StrategyParamsDialog";
import { DiagnosticsPage } from "@/pages/Diagnostics";
import { useFile, useUpdateFile } from "@/hooks/use-files";
import { useBacktest, useBacktests } from "@/hooks/use-backtests";
import { useUpdateConfig } from "@/hooks/use-config";
import { usePreferences } from "@/hooks/use-preferences";
import { Button } from "@/components/ui/button";
import { Save, Play, Loader2, MessageSquare, Layout, Activity, BarChart3, Cpu, Zap, Wifi, WifiOff, FileCode, Scale, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import type { ImperativePanelHandle } from "react-resizable-panels";
import { api } from "@shared/routes";

type ViewMode = "ide" | "backtest" | "results" | "comparison" | "diagnostics";

export default function Home() {
  const queryClient = useQueryClient();
  const [viewMode, setViewMode] = useState<ViewMode>("ide");
  const [activeSidebarTab, setActiveSidebarTab] = useState<"explorer" | "backtests">("explorer");
  const [activeFileId, setActiveFileId] = useState<number | null>(null);
  const [showBacktestDashboard, setShowBacktestDashboard] = useState(false);
  const [selectedResultsBacktestId, setSelectedResultsBacktestId] = useState<number | null>(null);
  const [selectedStrategyName, setSelectedStrategyName] = useState<string | null>(null);
  const [terminalLogs, setTerminalLogs] = useState<string[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [editorState, setEditorState] = useState<EditorState>({ selectedCode: "", lineNumber: 1, columnNumber: 1 });
  const editorRef = useRef<CodeEditorHandle>(null);
  const [paramsOpen, setParamsOpen] = useState(false);
  const [diagnosticsPlacement, setDiagnosticsPlacement] = usePreferences<"header" | "sidebar">(
    "diagnosticsPlacement",
    "header",
  );
  const chatPanelRef = useRef<ImperativePanelHandle>(null);

  const setChatOpenAndResize = useCallback((next: boolean) => {
    setChatOpen(next);
    // Collapse/expand the resizable panel so it actually frees up space.
    if (next) chatPanelRef.current?.expand();
    else chatPanelRef.current?.collapse();
  }, []);

  useEffect(() => {
    // Ensure chat is actually collapsed by default (PanelGroup default sizes may otherwise allocate space).
    if (!chatOpen) chatPanelRef.current?.collapse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  
  const { data: backtests } = useBacktests();
  const backtestById = (id: number | null) => {
    if (!id || !backtests) return null;
    return backtests.find((b) => b.id === id) ?? null;
  };

  const resultsBacktest = (() => {
    if (!backtests || backtests.length === 0) return undefined;

    const matchesStrategy = (b: any) => {
      if (!selectedStrategyName) return true;
      return b?.strategyName === selectedStrategyName;
    };

    const isCompleted = (b: any) => String(b?.status) === "completed";

    if (selectedResultsBacktestId != null) {
      const picked = backtests.find((b) => b.id === selectedResultsBacktestId);
      if (picked && isCompleted(picked) && matchesStrategy(picked)) {
        return picked;
      }
    }

    const completed = backtests
      .filter((b) => isCompleted(b))
      .filter((b) => matchesStrategy(b))
      .slice()
      .sort((a: any, b: any) => {
        const at = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bt = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
        return bt - at;
      });
    return completed[0];
  })();

  const resultsBacktestId = resultsBacktest?.id ?? null;
  const { data: freshResultsBacktest } = useBacktest(resultsBacktestId);
  const displayedResultsBacktest = freshResultsBacktest ?? resultsBacktest;

  // Connection status states
  const [aiStatus, setAiStatus] = useState<'connected' | 'disconnected' | 'checking'>('checking');
  const [cliStatus, setCliStatus] = useState<'connected' | 'disconnected' | 'checking'>('checking');

  const { data: models, isError: modelsError, isLoading: modelsLoading } = useQuery({
    queryKey: ["/api/ai/models"],
    retry: false,
  });

  useEffect(() => {
    if (modelsLoading) setAiStatus('checking');
    else if (modelsError) setAiStatus('disconnected');
    else if (models) setAiStatus('connected');
  }, [models, modelsError, modelsLoading]);

  useEffect(() => {
    const checkCli = async () => {
      try {
        const res = await fetch("/api/cmd", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command: "freqtrade --version" })
        });
        if (res.ok) setCliStatus('connected');
        else setCliStatus('disconnected');
      } catch {
        setCliStatus('disconnected');
      }
    };
    checkCli();
    const interval = setInterval(checkCli, 30000);
    return () => clearInterval(interval);
  }, []);

  const { data: activeFile, isLoading: fileLoading } = useFile(activeFileId);
  const updateFile = useUpdateFile();
  const updateConfig = useUpdateConfig();

  const activeFilePath = typeof (activeFile as any)?.path === "string" ? String((activeFile as any).path) : null;
  const isStrategyFile = Boolean(
    activeFilePath && activeFilePath.startsWith("user_data/strategies/") && activeFilePath.endsWith(".py"),
  );

  // Local state for editor content to handle unsaved changes
  const [editorContent, setEditorContent] = useState("");
  const [isDirty, setIsDirty] = useState(false);

  const chatFilePath = (() => {
    if (activeFilePath) return activeFilePath;
    if (displayedResultsBacktest?.strategyName) return String(displayedResultsBacktest.strategyName);
    if (selectedStrategyName) return String(selectedStrategyName);
    return null;
  })();

  const { data: chatFileFromDb } = useQuery({
    queryKey: [api.files.getByPath.path, chatFilePath],
    enabled: Boolean(chatOpen && chatFilePath && String(chatFilePath).startsWith("user_data/strategies/")),
    queryFn: async () => {
      if (!chatFilePath) return null;
      const res = await fetch(`${api.files.getByPath.path}?path=${encodeURIComponent(chatFilePath)}`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
  });

  const chatFileContent =
    activeFilePath && chatFilePath === activeFilePath
      ? editorContent
      : (typeof (chatFileFromDb as any)?.content === "string" ? String((chatFileFromDb as any).content) : "");

  useEffect(() => {
    if (activeFile) {
      setEditorContent(activeFile.content);
      setIsDirty(false);
    }
  }, [activeFile]);

  useEffect(() => {
    setParamsOpen(false);
  }, [activeFileId]);

  useEffect(() => {
    const p = (activeFile as any)?.path;
    if (typeof p !== "string") return;
    const isStrategy = p.startsWith("user_data/strategies/") && p.endsWith(".py");
    if (!isStrategy) return;
    setSelectedStrategyName(p);
    setSelectedResultsBacktestId(null);
  }, [activeFile]);

  const handleEditorChange = (value: string | undefined) => {
    if (value !== undefined) {
      setEditorContent(value);
      setIsDirty(true);
    }
  };

  const handleSave = () => {
    if (activeFileId) {
      updateFile.mutate({ id: activeFileId, content: editorContent }, {
        onSuccess: () => {
          setIsDirty(false);
          // Add system message to chat
          setChatSystemMessage(`Successfully saved ${activeFile?.path.split('/').pop()}`);
        }
      });
    }
  };

  const [chatSystemMessage, setChatSystemMessage] = useState<string | null>(null);

  useEffect(() => {
    if (chatSystemMessage) {
      const timer = setTimeout(() => setChatSystemMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [chatSystemMessage]);

  const handleBacktestSelect = () => {
    setViewMode("backtest");
    setShowBacktestDashboard(true);
  };

  const handleFileSelect = (id: number) => {
    if (isDirty) {
      if (!confirm("You have unsaved changes. Discard them?")) return;
    }
    setActiveFileId(id);
    setViewMode("ide");
    setShowBacktestDashboard(false);
  };

  const handleEditorStateChange = useCallback((state: EditorState) => {
    setEditorState(state);
  }, []);

  return (
    <div className="h-screen w-full bg-background flex flex-col overflow-hidden">
      {/* Main App Header */}
      <header className="h-12 border-b border-border/50 bg-slate-100 dark:bg-[#0f1729] flex items-center px-4 justify-between z-10 shadow-lg backdrop-blur-sm">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-gradient-accent flex items-center justify-center shadow-md glow-accent">
              <Activity className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-sm tracking-tight uppercase text-gradient">FreqTrade IDE</span>
          </div>

          <nav className="flex items-center bg-gradient-accent-subtle rounded-lg p-0.5 border border-border/30">
            <Button 
              variant="ghost" 
              size="sm" 
              className={cn(
                "h-8 px-3 text-xs gap-2 transition-all duration-200",
                viewMode === "ide" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
              onClick={() => {
                setViewMode("ide");
                setShowBacktestDashboard(false);
              }}
            >
              <Layout className="w-3.5 h-3.5" />
              Editor
            </Button>
            <Button 
              variant="ghost" 
              size="sm" 
              className={cn(
                "h-8 px-3 text-xs gap-2 transition-all duration-200",
                viewMode === "backtest" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
              onClick={() => {
                setViewMode("backtest");
                setShowBacktestDashboard(true);
              }}
            >
              <Play className="w-3.5 h-3.5" />
              Backtest
            </Button>
            <Button 
              variant="ghost" 
              size="sm" 
              className={cn(
                "h-8 px-3 text-xs gap-2 transition-all duration-200",
                viewMode === "results" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
              onClick={() => {
                setViewMode("results");
                setShowBacktestDashboard(false);
              }}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              Results
            </Button>
            <Button 
              variant="ghost" 
              size="sm" 
              className={cn(
                "h-8 px-3 text-xs gap-2 transition-all duration-200",
                viewMode === "comparison" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
              onClick={() => setViewMode("comparison")}
            >
              <Scale className="w-3.5 h-3.5" />
              Compare
            </Button>
            {diagnosticsPlacement === "header" && (
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "h-8 px-3 text-xs gap-2 transition-all duration-200",
                  viewMode === "diagnostics" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
                    onClick={() => {
                      setViewMode("diagnostics");
                      setShowBacktestDashboard(false);
                    }}
                  >
                    <Activity className="w-3.5 h-3.5" />
                    Diagnostics
                  </Button>
            )}
          </nav>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3 mr-2 px-3 py-1.5 bg-gradient-card rounded-full border border-border/30 shadow-inner">
            <div 
              className="flex items-center gap-1.5" 
              title={aiStatus === 'connected' ? "OpenRouter AI Connected" : aiStatus === 'checking' ? "Checking OpenRouter AI..." : "OpenRouter AI Disconnected"}
              data-testid="status-ai"
            >
              {aiStatus === 'checking' ? (
                <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin" />
              ) : aiStatus === 'connected' ? (
                <Zap className="w-3.5 h-3.5 text-primary animate-pulse" />
              ) : (
                <WifiOff className="w-3.5 h-3.5 text-destructive" />
              )}
              <span className={cn(
                "text-[10px] font-bold uppercase tracking-wider",
                aiStatus === 'connected' ? "text-primary" : aiStatus === 'checking' ? "text-muted-foreground" : "text-destructive"
              )}>AI</span>
              <div className={cn(
                "w-1.5 h-1.5 rounded-full transition-all duration-300",
                aiStatus === 'connected' ? "bg-primary shadow-[0_0_8px_hsl(var(--primary)/0.5)]" : 
                aiStatus === 'checking' ? "bg-muted-foreground animate-pulse" : "bg-destructive"
              )} />
            </div>

            <div className="w-px h-3 bg-border" />

            <div 
              className="flex items-center gap-1.5" 
              title={cliStatus === 'connected' ? "FreqTrade CLI Connected" : cliStatus === 'checking' ? "Checking FreqTrade CLI..." : "FreqTrade CLI Disconnected"}
              data-testid="status-cli"
            >
              {cliStatus === 'checking' ? (
                <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin" />
              ) : cliStatus === 'connected' ? (
                <Cpu className="w-3.5 h-3.5 text-green-500" />
              ) : (
                <WifiOff className="w-3.5 h-3.5 text-destructive" />
              )}
              <span className={cn(
                "text-[10px] font-bold uppercase tracking-wider",
                cliStatus === 'connected' ? "text-green-500" : cliStatus === 'checking' ? "text-muted-foreground" : "text-destructive"
              )}>CLI</span>
              <div className={cn(
                "w-1.5 h-1.5 rounded-full transition-all duration-300",
                cliStatus === 'connected' ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]" : 
                cliStatus === 'checking' ? "bg-muted-foreground animate-pulse" : "bg-destructive"
              )} />
            </div>
          </div>

          <ChatToggleButton isOpen={chatOpen} onToggle={() => setChatOpenAndResize(!chatOpen)} />
        </div>
      </header>
      
      <div className="flex-1 flex overflow-hidden">
        {/* LEFT SIDEBAR - DOCKABLE */}
        <div
          className={cn(
            "transition-all duration-300 ease-in-out overflow-hidden border-r border-border/50",
            sidebarOpen ? "w-[280px] opacity-100" : "w-0 opacity-0",
          )}
        >
          {sidebarOpen && (
            <div className="h-full bg-sidebar flex flex-col">
              <Sidebar
                activeTab={activeSidebarTab}
                setActiveTab={setActiveSidebarTab}
                onFileSelect={handleFileSelect}
                onBacktestSelect={handleBacktestSelect}
                selectedStrategyName={selectedStrategyName}
                showDiagnosticsIcon={diagnosticsPlacement === "sidebar"}
                diagnosticsActive={viewMode === "diagnostics"}
                onDiagnosticsSelect={() => {
                  setViewMode("diagnostics");
                  setShowBacktestDashboard(false);
                }}
                onViewBacktest={(backtestId) => {
                  const bt = backtestById(backtestId);
                  if (bt?.strategyName) {
                    setSelectedStrategyName(bt.strategyName);
                  }
                  setSelectedResultsBacktestId(backtestId);
                  setViewMode("results");
                  setShowBacktestDashboard(false);
                }}
              />
            </div>
          )}
        </div>

        {/* MAIN + CHAT (RESIZABLE) */}
        <ResizablePanelGroup direction="horizontal" className="flex-1" autoSaveId="layout:home-main-chat">
          <ResizablePanel defaultSize={chatOpen ? 65 : 100} minSize={30} className="transition-all duration-300 ease-in-out">
            <ResizablePanelGroup direction="vertical" className="h-full">
            
            {/* EDITOR / DASHBOARD AREA */}
            <ResizablePanel defaultSize={70} minSize={30}>
              <div className="h-full flex flex-col">
                {/* View Content based on ViewMode */}
                {viewMode === "ide" ? (
                  <div className="h-full flex flex-col">
                    {/* Editor Tabs / Toolbar */}
                    <div className="h-10 border-b border-border bg-background flex items-center px-4 justify-between">
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => setSidebarOpen(!sidebarOpen)}
                          title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
                        >
                          {sidebarOpen ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </Button>
                        {activeFile ? (
                          <>
                            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-secondary/50 border border-border/30">
                              <FileCode className="w-3.5 h-3.5 text-primary" />
                              <span className="text-sm font-medium text-foreground">{activeFile.path.split('/').pop()}</span>
                            </div>
                            {isDirty && <div className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" title="Unsaved changes" />}
                            <span className="ml-2 text-[10px] font-mono text-muted-foreground bg-secondary/30 px-1.5 py-0.5 rounded border border-border/30">
                              LINE {editorState.lineNumber}
                            </span>
                            {editorState.selectedCode && (
                              <Badge variant="outline" className="h-5 px-1.5 text-[9px] bg-primary/10 text-primary border-primary/20">
                                {editorState.selectedCode.split('\n').length} LINES SELECTED
                              </Badge>
                            )}
                          </>
                        ) : (
                          <span className="text-sm text-muted-foreground">No file open</span>
                        )}
                      </div>
                      
                      <div className="flex items-center gap-2">
                        {activeFile && (
                          <>
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              onClick={handleSave}
                              disabled={!isDirty || updateFile.isPending}
                              className="h-7 text-xs gap-1.5"
                            >
                              {updateFile.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                              Save
                            </Button>
                            {isStrategyFile && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs gap-1.5"
                                onClick={() => setParamsOpen(true)}
                              >
                                <Scale className="w-3 h-3" />
                                Params
                              </Button>
                            )}
                            {activeFile.type === 'python' && (
                              <Button 
                                variant="default" 
                                size="sm" 
                                className="h-7 text-xs gap-1.5 bg-green-600 hover:bg-green-700"
                                onClick={() => {
                                  setActiveSidebarTab("backtests");
                                  handleBacktestSelect();
                                }}
                              >
                                <Play className="w-3 h-3" />
                                Run Backtest
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                    </div>

                    {/* Editor Content */}
                    <div className="flex-1 overflow-hidden relative bg-[#1e1e1e]">
                      <StrategyParamsDialog
                        open={paramsOpen}
                        onOpenChange={setParamsOpen}
                        strategyPath={isStrategyFile ? activeFilePath : null}
                      />
                      {activeFile ? (
                        fileLoading ? (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                          </div>
                        ) : (
                          <CodeEditor 
                            ref={editorRef}
                            language={activeFile.type === 'python' ? 'python' : activeFile.type === 'json' ? 'json' : 'plaintext'}
                            value={editorContent}
                            onChange={handleEditorChange}
                            onEditorStateChange={handleEditorStateChange}
                            onSave={async (content) => {
                              return new Promise((resolve, reject) => {
                                updateFile.mutate({ id: activeFileId!, content }, {
                                  onSuccess: () => {
                                    setIsDirty(false);
                                    resolve();
                                  },
                                  onError: reject
                                });
                              });
                            }}
                            onToggleChat={() => setChatOpen(!chatOpen)}
                            isChatOpen={chatOpen}
                          />
                        )
                      ) : (
                        <div className="h-full flex flex-col items-center justify-center text-muted-foreground space-y-4">
                          <div className="w-16 h-16 rounded-2xl bg-gradient-accent-subtle flex items-center justify-center mb-2 border border-border/30">
                            <CodeEditorIcon className="w-8 h-8 opacity-50" />
                          </div>
                          <p>Select a file from the explorer to start coding</p>
                          <p className="text-xs opacity-50">Press Ctrl+S to save changes</p>
                        </div>
                      )}
                    </div>
                  </div>
                ) : viewMode === "results" ? (
                  <div className="h-full flex flex-col">
                    {displayedResultsBacktest?.results ? (
                      <BacktestResults 
                        key={displayedResultsBacktest.id}
                        backtestId={displayedResultsBacktest.id}
                        strategyName={displayedResultsBacktest.strategyName}
                        stakeAmount={(displayedResultsBacktest as any)?.config?.stake_amount}
                        results={displayedResultsBacktest.results as any} 
                      />
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center p-8 bg-card/30 rounded-lg border border-dashed border-border/50 m-4">
                        <div className="p-4 rounded-full bg-primary/5 mb-4">
                          <BarChart3 className="w-12 h-12 text-primary/40" />
                        </div>
                        <h2 className="text-xl font-bold text-foreground">Ready for Analysis</h2>
                        <p className="text-sm text-center max-w-sm mt-2 text-muted-foreground leading-relaxed">
                          Run your first backtest in the <span className="text-primary font-medium">Backtest tab</span> to unlock detailed performance analytics, trade history, and AI-powered strategy insights.
                        </p>
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="mt-6 gap-2 hover-elevate"
                          onClick={() => setViewMode("backtest")}
                        >
                          <Activity className="w-4 h-4" />
                          Open Backtest Dashboard
                        </Button>
                      </div>
                    )}
                  </div>
                ) : viewMode === "comparison" ? (
                  <StrategyComparison />
                ) : viewMode === "diagnostics" ? (
                  <DiagnosticsPage
                    selectedStrategyName={selectedStrategyName}
                    placement={diagnosticsPlacement}
                    onPlacementChange={setDiagnosticsPlacement}
                    onOpenChat={() => setChatOpenAndResize(true)}
                  />
                ) : (
                  <div className="h-full flex flex-col">
                    <div className="h-10 border-b border-border bg-background flex items-center px-4">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 mr-2"
                        onClick={() => setSidebarOpen(!sidebarOpen)}
                        title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
                      >
                        {sidebarOpen ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </Button>
                      <span className="text-sm font-medium text-foreground">Backtest Dashboard</span>
                    </div>
                    <div className="flex-1 overflow-hidden">
                      <BacktestDashboard
                        selectedStrategyName={selectedStrategyName}
                        onLog={(log) => setTerminalLogs(prev => [...prev, log])}
                        onBacktestCompleted={(backtestId) => {
                          const bt = backtestById(backtestId);
                          if (bt?.strategyName) {
                            setSelectedStrategyName(bt.strategyName);
                          }
                          setSelectedResultsBacktestId(backtestId);
                          setViewMode("results");
                          setShowBacktestDashboard(false);
                        }}
                        onStrategySelected={(strategyName) => {
                          setSelectedStrategyName(strategyName);
                          setSelectedResultsBacktestId(null);
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </ResizablePanel>
            
            <ResizableHandle className="h-1 bg-border/50 hover:bg-gradient-accent transition-all duration-300" />
            
            {/* BOTTOM TERMINAL PANEL */}
            <ResizablePanel defaultSize={30} minSize={10}>
              <TerminalPanel logs={terminalLogs} onCommand={(log) => setTerminalLogs(prev => [...prev, log])} />
            </ResizablePanel>
            
            </ResizablePanelGroup>
          </ResizablePanel>

          <ResizableHandle withHandle className={cn(!chatOpen && "hidden")} />

          <ResizablePanel
            ref={chatPanelRef}
            defaultSize={35}
            minSize={22}
            collapsible
            collapsedSize={0}
            className="min-w-0"
          >
              <ChatPanel
              isOpen={chatOpen}
              onToggle={() => setChatOpenAndResize(!chatOpen)}
              context={{
                fileName: chatFilePath ?? undefined,
                fileContent: chatFileContent,
                selectedCode: (activeFilePath && chatFilePath === activeFilePath) ? editorState.selectedCode : "",
                lineNumber: (activeFilePath && chatFilePath === activeFilePath) ? editorState.lineNumber : undefined,
                columnNumber: (activeFilePath && chatFilePath === activeFilePath) ? editorState.columnNumber : undefined,
                lastBacktest: displayedResultsBacktest
                  ? {
                      id: displayedResultsBacktest.id,
                      strategyName: displayedResultsBacktest.strategyName,
                      // @ts-ignore
                      config: displayedResultsBacktest.config,
                    }
                  : undefined,
                backtestResults: displayedResultsBacktest?.results
                  ? {
                      profit_total: parseFloat((displayedResultsBacktest.results as any).profit_total) * 100,
                      win_rate: parseFloat((displayedResultsBacktest.results as any).win_rate) * 100,
                      max_drawdown: parseFloat((displayedResultsBacktest.results as any).max_drawdown) * 100,
                      total_trades: (displayedResultsBacktest.results as any).total_trades,
                      avg_profit: (displayedResultsBacktest.results as any).avg_profit_per_trade,
                      sharpe: (displayedResultsBacktest.results as any).sharpe_ratio,
                    }
                  : undefined,
              }}
              onApplyCode={(code, mode) => {
                const inferFnName = (src: string): string | null => {
                  const m = String(src || "").match(/\bdef\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/m);
                  return m && m[1] ? String(m[1]) : null;
                };
                const isSingleFunctionSnippet = (src: string): string | null => {
                  const text = String(src || "");
                  if (/\bclass\s+[A-Za-z_][A-Za-z0-9_]*\b/.test(text)) return null;
                  const defs = text.match(/\bdef\s+[A-Za-z_][A-Za-z0-9_]*\s*\(/g) || [];
                  if (defs.length !== 1) return null;
                  return inferFnName(text);
                };

                const fnName = isSingleFunctionSnippet(code);
                if (mode === "enclosingFunction") {
                  const ok = editorRef.current?.replaceEnclosingFunction(code);
                  if (!ok) {
                    editorRef.current?.applyCode(code);
                    setChatSystemMessage("Could not find enclosing function; inserted at cursor instead");
                    return;
                  }
                  setChatSystemMessage("AI code suggestion applied (replaced current function)");
                  return;
                }

                if (mode === "namedFunction" && fnName) {
                  const ok = editorRef.current?.replaceFunctionByName(fnName, code);
                  if (ok) {
                    setChatSystemMessage(`AI code suggestion applied (replaced '${fnName}')`);
                    return;
                  }
                  editorRef.current?.applyCode(code);
                  setChatSystemMessage(`Could not find '${fnName}' in file; inserted at cursor instead`);
                  return;
                }

                // If the AI returns a single function, prefer replacing by name (safer than blind insert).
                if (mode === "cursor" && fnName) {
                  const ok = editorRef.current?.replaceFunctionByName(fnName, code);
                  if (ok) {
                    setChatSystemMessage(`AI code suggestion applied (replaced '${fnName}')`);
                    return;
                  }
                }

                editorRef.current?.applyCode(code);
                setChatSystemMessage("AI code suggestion applied to editor");
              }}
              onApplyAndSaveCode={(code, mode) => {
                const inferFnName = (src: string): string | null => {
                  const m = String(src || "").match(/\bdef\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/m);
                  return m && m[1] ? String(m[1]) : null;
                };
                const isSingleFunctionSnippet = (src: string): string | null => {
                  const text = String(src || "");
                  if (/\bclass\s+[A-Za-z_][A-Za-z0-9_]*\b/.test(text)) return null;
                  const defs = text.match(/\bdef\s+[A-Za-z_][A-Za-z0-9_]*\s*\(/g) || [];
                  if (defs.length !== 1) return null;
                  return inferFnName(text);
                };

                const p = (activeFile as any)?.path;
                const isStrategy =
                  typeof p === "string" &&
                  p.startsWith("user_data/strategies/") &&
                  p.endsWith(".py");
                if (!isStrategy || !activeFileId) {
                  setChatSystemMessage("Open a strategy file to apply & save");
                  return;
                }

                const fnName = isSingleFunctionSnippet(code);

                if (mode === "enclosingFunction") {
                  const ok = editorRef.current?.replaceEnclosingFunction(code);
                  if (!ok) {
                    editorRef.current?.applyCode(code);
                    setChatSystemMessage("Could not find enclosing function; inserted at cursor instead");
                  }
                } else if (mode === "namedFunction" && fnName) {
                  const ok = editorRef.current?.replaceFunctionByName(fnName, code);
                  if (!ok) {
                    editorRef.current?.applyCode(code);
                    setChatSystemMessage(`Could not find '${fnName}' in file; inserted at cursor instead`);
                  }
                } else {
                  // If the AI returns a single function, prefer replacing by name (safer than blind insert).
                  if (mode === "cursor" && fnName) {
                    const ok = editorRef.current?.replaceFunctionByName(fnName, code);
                    if (!ok) {
                      editorRef.current?.applyCode(code);
                    }
                  } else {
                    editorRef.current?.applyCode(code);
                  }
                }
                const nextContent = editorRef.current?.getValue?.() ?? editorContent;

                updateFile.mutate(
                  { id: activeFileId, content: nextContent },
                  {
                    onSuccess: () => {
                      setEditorContent(nextContent);
                      setIsDirty(false);
                      setChatSystemMessage("AI change applied and saved");
                    },
                    onError: (err: any) => {
                      setChatSystemMessage(String(err?.message || "Save failed"));
                    },
                  },
                );
              }}
              onApplyConfig={(patch) => {
                if (!patch || typeof patch !== "object") return;
                const ok = confirm("Apply these config changes now?");
                if (!ok) return;
                updateConfig.mutate(patch as any, {
                  onSuccess: () => {
                    setChatSystemMessage("Config updated");
                  },
                  onError: (err: any) => {
                    setChatSystemMessage(String(err?.message || "Config update failed"));
                  },
                });
              }}
              onPreviewValidatedEdit={async ({ strategyPath, edits, dryRun }) => {
                const path = String(strategyPath || "").trim();
                if (!path.startsWith("user_data/strategies/") || !path.endsWith(".py")) {
                  throw new Error("strategyPath must be a .py file under user_data/strategies/");
                }
                if (!Array.isArray(edits) || edits.length === 0) {
                  throw new Error("No edits provided");
                }

                const res = await fetch(api.strategies.edit.path, {
                  method: api.strategies.edit.method,
                  headers: { "Content-Type": "application/json" },
                  credentials: "include",
                  body: JSON.stringify({ strategyPath: path, edits, dryRun: Boolean(dryRun) }),
                });

                const data = await res.json().catch(() => ({}));
                if (!res.ok) {
                  const msg =
                    (data && typeof data === "object" && typeof (data as any).message === "string")
                      ? String((data as any).message)
                      : "Rejected change(s)";
                  const details =
                    (data && typeof data === "object" && typeof (data as any).details === "string")
                      ? String((data as any).details)
                      : "";
                  throw new Error(details ? `${msg}: ${details}` : msg);
                }

                if (!dryRun) {
                  const nextContent = typeof (data as any)?.content === "string" ? String((data as any).content) : null;

                  queryClient.invalidateQueries({ queryKey: [api.files.list.path] });
                  queryClient.invalidateQueries({ queryKey: [api.files.getByPath.path, path] });
                  if (activeFileId) {
                    queryClient.invalidateQueries({ queryKey: [api.files.get.path, activeFileId] });
                  }

                  if (activeFilePath && activeFilePath === path && nextContent != null) {
                    setEditorContent(nextContent);
                    setIsDirty(false);
                  }

                  setChatSystemMessage(`Strategy updated: ${path.split("/").pop()}`);
                }

                return data;
              }}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
        
        {chatSystemMessage && (
          <div className="fixed bottom-20 right-8 z-50">
            <div className="bg-gradient-accent text-white px-4 py-2 rounded-md shadow-lg glow-accent text-xs flex items-center gap-2 animate-in slide-in-from-bottom-2 fade-in duration-300">
              <Activity className="w-3 h-3" />
              {chatSystemMessage}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

function CodeEditorIcon(props: any) {
  return (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 20H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v8"/><path d="m14 2 4 4-4 4"/><path d="M12 22v-8"/></svg>
  );
}
