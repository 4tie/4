import { useState, useRef, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageSquare, X, Send, Loader2, Bot, User, Code, FileCode, Save, PanelRightClose, PanelRightOpen, Zap, BarChart3, Eye } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { useAIStore } from "@/hooks/use-ai";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, buildUrl } from "@shared/routes";

interface ChatContext {
  fileName?: string;
  fileContent?: string;
  selectedCode?: string;
  lineNumber?: number;
  cursorFunctionName?: string;
  lastBacktest?: {
    id?: number;
    strategyName?: string;
    config?: any;
  };
  backtestResults?: {
    profit_total: number;
    win_rate: number;
    max_drawdown: number;
    total_trades: number;
    avg_profit?: number;
    sharpe?: number;
  };
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

type RefinementStage = "idle" | "starting" | "running" | "completed" | "failed";
type RefinementRunType = "single" | "batch";

type BacktestSummary = {
  id: number;
  profitTotal: number | null;
  winRate: number | null;
  maxDrawdown: number | null;
  totalTrades: number | null;
};

type RefinementState = {
  type: RefinementRunType;
  stage: RefinementStage;
  startedAt: number;
  updatedAt: number;
  strategyName: string;
  ids: number[];
  completedIds: number[];
  lastLogLine: string | null;
  summaries: BacktestSummary[];
};

function createMessageId() {
  try {
    const c: any = (globalThis as any)?.crypto;
    if (c?.randomUUID) {
      return c.randomUUID();
    }
    if (c?.getRandomValues) {
      const bytes = new Uint8Array(16);
      c.getRandomValues(bytes);
      // RFC4122 version 4
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
      return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
        .slice(6, 8)
        .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
    }
  } catch {
    // ignore
  }

  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
}

interface ChatPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  context: ChatContext;
  onApplyCode?: (code: string, mode?: "selection" | "cursor" | "enclosingFunction") => void;
  onApplyConfig?: (patch: Record<string, unknown>) => void;
  onApplyAndSaveCode?: (code: string, mode?: "selection" | "cursor" | "enclosingFunction") => void;
}

export function ChatToggleButton({ isOpen, onToggle }: { isOpen: boolean; onToggle: () => void }) {
  return (
    <Button
      data-testid="button-toggle-chat"
      size="icon"
      variant="ghost"
      onClick={onToggle}
      className="toggle-elevate"
      title={isOpen ? "Hide AI Chat" : "Show AI Chat"}
    >
      {isOpen ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
    </Button>
  );
}

type ExtractedBlock = {
  lang: string;
  code: string;
};

type ParsedAction =
  | { action: "run_backtest"; payload: any }
  | { action: "run_batch_backtest"; payload: any }
  | { action: string; payload: any };

const parseActionBlock = (block: ExtractedBlock): ParsedAction | null => {
  const lang = String(block.lang || "").trim().toLowerCase();
  if (lang !== "action" && lang !== "actions" && lang !== "tool" && lang !== "run") return null;
  if (!block.code || !String(block.code).trim()) return null;
  try {
    const parsed = JSON.parse(block.code);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const action = typeof (parsed as any).action === "string" ? String((parsed as any).action) : "";
    if (!action) return null;
    const payload = (parsed as any).payload;
    return { action: action as any, payload };
  } catch {
    return null;
  }
};

const extractCodeBlocks = (content: string): ExtractedBlock[] => {
  const regex = /```\s*([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
  const blocks: ExtractedBlock[] = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    blocks.push({
      lang: String(match[1] || "").trim().toLowerCase(),
      code: match[2],
    });
  }
  return blocks;
};

const parseConfigPatch = (block: ExtractedBlock): Record<string, unknown> | null => {
  const allowed = new Set([
    "strategy",
    "timeframe",
    "stake_amount",
    "max_open_trades",
    "tradable_balance_ratio",
    "trailing_stop",
    "trailing_stop_positive",
    "trailing_stop_positive_offset",
    "trailing_only_offset_is_reached",
    "minimal_roi",
    "stoploss",
    "backtest_date_from",
    "backtest_date_to",
    "pairs",
  ]);

  if (!block.code || !String(block.code).trim()) return null;

  const seemsJson =
    block.lang === "json" ||
    block.lang === "config" ||
    block.lang === "configjson" ||
    block.lang === "config.json";

  try {
    const parsed = JSON.parse(block.code);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (allowed.has(k)) out[k] = v;
    }

    return Object.keys(out).length > 0 ? out : (seemsJson ? {} : null);
  } catch {
    return seemsJson ? {} : null;
  }
};

const inferPythonFunctionName = (src: string): string | null => {
  const m = String(src || "").match(/\bdef\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/m);
  return m && m[1] ? String(m[1]) : null;
};

const leadingIndent = (line: string) => {
  const m = String(line || "").match(/^\s*/);
  return m?.[0]?.length ?? 0;
};

const isPythonDefLine = (line: string) => /^\s*def\s+[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(String(line || ""));
const isPythonDecoratorLine = (line: string) => /^\s*@/.test(String(line || ""));
const isPythonClassLine = (line: string) => /^\s*class\s+[A-Za-z_][A-Za-z0-9_]*\s*[(:]/.test(String(line || ""));

const inferEnclosingPythonFunctionNameFromFile = (fileContent: string | undefined, lineNumber: number | undefined): string | null => {
  if (!fileContent) return null;
  const lines = String(fileContent).split(/\r?\n/);
  const total = lines.length;
  if (!total) return null;
  const target = Math.min(Math.max(1, Number(lineNumber || 1)), total);

  let searchFrom = target;
  while (searchFrom >= 1) {
    let defLine = -1;
    for (let i = searchFrom; i >= 1; i--) {
      const line = lines[i - 1] ?? "";
      if (isPythonDefLine(line)) {
        defLine = i;
        break;
      }
    }
    if (defLine === -1) return null;

    const defIndent = leadingIndent(lines[defLine - 1] ?? "");
    let startLine = defLine;
    while (startLine > 1) {
      const prev = lines[startLine - 2] ?? "";
      if (!isPythonDecoratorLine(prev)) break;
      if (leadingIndent(prev) !== defIndent) break;
      startLine--;
    }

    let endLine = total;
    for (let i = defLine + 1; i <= total; i++) {
      const line = lines[i - 1] ?? "";
      if (!String(line).trim()) continue;

      const ind = leadingIndent(line);
      if (ind < defIndent) {
        endLine = i - 1;
        break;
      }
      if (ind === defIndent && (isPythonDefLine(line) || isPythonDecoratorLine(line) || isPythonClassLine(line))) {
        endLine = i - 1;
        break;
      }
    }

    if (target >= startLine && target <= endLine) {
      return inferPythonFunctionName(lines[defLine - 1] ?? "");
    }

    searchFrom = defLine - 1;
  }

  return null;
};

const inferEnclosingPythonFunctionBlockFromFile = (
  fileContent: string | undefined,
  lineNumber: number | undefined,
): { name: string | null; startLine: number; endLine: number; code: string } | null => {
  if (!fileContent) return null;
  const lines = String(fileContent).split(/\r?\n/);
  const total = lines.length;
  if (!total) return null;
  const target = Math.min(Math.max(1, Number(lineNumber || 1)), total);

  let searchFrom = target;
  while (searchFrom >= 1) {
    let defLine = -1;
    for (let i = searchFrom; i >= 1; i--) {
      const line = lines[i - 1] ?? "";
      if (isPythonDefLine(line)) {
        defLine = i;
        break;
      }
    }
    if (defLine === -1) return null;

    const defIndent = leadingIndent(lines[defLine - 1] ?? "");
    let startLine = defLine;
    while (startLine > 1) {
      const prev = lines[startLine - 2] ?? "";
      if (!isPythonDecoratorLine(prev)) break;
      if (leadingIndent(prev) !== defIndent) break;
      startLine--;
    }

    let endLine = total;
    for (let i = defLine + 1; i <= total; i++) {
      const line = lines[i - 1] ?? "";
      if (!String(line).trim()) continue;

      const ind = leadingIndent(line);
      if (ind < defIndent) {
        endLine = i - 1;
        break;
      }
      if (ind === defIndent && (isPythonDefLine(line) || isPythonDecoratorLine(line) || isPythonClassLine(line))) {
        endLine = i - 1;
        break;
      }
    }

    if (target >= startLine && target <= endLine) {
      const code = lines.slice(startLine - 1, endLine).join("\n");
      return {
        name: inferPythonFunctionName(lines[defLine - 1] ?? ""),
        startLine,
        endLine,
        code,
      };
    }

    searchFrom = defLine - 1;
  }

  return null;
};

const getCursorContextSnippet = (fileContent: string | undefined, lineNumber: number | undefined, radius = 6): string => {
  if (!fileContent) return "";
  const lines = String(fileContent).split(/\r?\n/);
  const total = lines.length;
  if (!total) return "";
  const target = Math.min(Math.max(1, Number(lineNumber || 1)), total);
  const start = Math.max(1, target - radius);
  const end = Math.min(total, target + radius);
  return lines.slice(start - 1, end).join("\n");
};

const shouldWarnFunctionMismatch = (
  selectedCode: string | undefined,
  cursorFunctionName: string | null,
  snippet: ExtractedBlock,
): string | null => {
  if (snippet.lang !== "python" && snippet.lang !== "py") return null;
  const sel = typeof selectedCode === "string" ? selectedCode : "";

  const selectedFn = sel.trim() ? inferPythonFunctionName(sel) : null;
  const targetFn = selectedFn || cursorFunctionName;
  const snippetFn = inferPythonFunctionName(snippet.code);
  if (!targetFn || !snippetFn) return null;
  if (targetFn === snippetFn) return null;

  return `Cursor/selection appears inside \'${targetFn}\', but the AI snippet defines \'${snippetFn}\'. Apply anyway?`;
};

export function ChatPanel({ isOpen, onToggle, context, onApplyCode, onApplyConfig, onApplyAndSaveCode }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [autoExplain, setAutoExplain] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem("chat:autoExplainRefinement");
      if (raw == null) return true;
      return raw === "true";
    } catch {
      return true;
    }
  });
  const [refinement, setRefinement] = useState<RefinementState | null>(null);
  const [preview, setPreview] = useState<null | {
    title: string;
    mode: "selection" | "cursor" | "enclosingFunction";
    currentLabel: string;
    current: string;
    proposed: string;
    mismatchWarning: string | null;
  }>(null);
  const { selectedModel } = useAIStore();
  const queryClient = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);
  const refinementPollerRef = useRef<number | null>(null);
  const refinementPollInFlightRef = useRef(false);
  const refinementRef = useRef<RefinementState | null>(null);
  const announcedCompletedRef = useRef<Set<number>>(new Set());
  const hasSelection = Boolean(context.selectedCode && String(context.selectedCode).trim().length > 0);
  const enclosingFunctionBlock = useMemo(() => {
    return inferEnclosingPythonFunctionBlockFromFile(context.fileContent, context.lineNumber);
  }, [context.fileContent, context.lineNumber]);
  const cursorFunctionName = useMemo(() => {
    if (typeof context.cursorFunctionName === "string" && context.cursorFunctionName.trim()) {
      return context.cursorFunctionName.trim();
    }
    return enclosingFunctionBlock?.name ?? inferEnclosingPythonFunctionNameFromFile(context.fileContent, context.lineNumber);
  }, [context.cursorFunctionName, context.fileContent, context.lineNumber, enclosingFunctionBlock?.name]);
  const canApplyAndSave =
    Boolean(context.fileName) &&
    String(context.fileName).startsWith("user_data/strategies/") &&
    String(context.fileName).endsWith(".py");

  const pushMessage = (role: Message["role"], content: string) => {
    setMessages((prev) => [
      ...prev,
      {
        id: createMessageId(),
        role,
        content,
        timestamp: new Date(),
      },
    ]);
  };

  const toNum = (value: unknown): number => {
    const n = typeof value === "number" ? value : typeof value === "string" ? parseFloat(value) : NaN;
    return Number.isFinite(n) ? n : NaN;
  };

  const normalizeRatio = (value: unknown): number | null => {
    const n = toNum(value);
    if (!Number.isFinite(n)) return null;
    if (Math.abs(n) > 1.5) return n / 100;
    return n;
  };

  const formatDuration = (ms: number): string => {
    const s = Math.max(0, Math.floor(ms / 1000));
    const mm = Math.floor(s / 60);
    const ss = s % 60;
    return `${mm}m ${ss}s`;
  };

  const estimateRemainingMs = (r: RefinementState | null): number | null => {
    if (!r) return null;
    if (!r.ids.length) return null;
    const completed = r.completedIds.length;
    const remaining = r.ids.length - completed;
    if (remaining <= 0) return 0;
    if (completed <= 0) return null;
    const elapsed = Date.now() - r.startedAt;
    const avgPerRun = elapsed / completed;
    if (!Number.isFinite(avgPerRun) || avgPerRun <= 0) return null;
    const est = Math.max(0, Math.round(avgPerRun * remaining));
    return Number.isFinite(est) ? est : null;
  };

  const buildBacktestSummary = (backtest: any): BacktestSummary | null => {
    const id = Number(backtest?.id);
    if (!Number.isFinite(id)) return null;
    const r = backtest?.results;
    return {
      id,
      profitTotal: normalizeRatio(r?.profit_total),
      winRate: normalizeRatio(r?.win_rate),
      maxDrawdown: normalizeRatio(r?.max_drawdown),
      totalTrades: Number.isFinite(toNum(r?.total_trades)) ? toNum(r?.total_trades) : null,
    };
  };

  const explainNextFocus = (summary: BacktestSummary): string => {
    const trades = summary.totalTrades ?? 0;
    const p = summary.profitTotal;
    const wr = summary.winRate;
    const dd = summary.maxDrawdown;

    if (trades > 0 && trades < 30) {
      return "Focus next: increase sample size (longer timerange / more pairs) before making aggressive logic changes.";
    }
    if (p != null && p < 0) {
      if (wr != null && wr > 0.55) {
        return "Focus next: expectancy (winners too small vs losers). Tighten stoploss or improve exits to cut large losers.";
      }
      return "Focus next: improve edge (entries / filters) and reduce drawdown. Add regime filters or reduce noise trades.";
    }
    if (dd != null && dd >= 0.2) {
      return "Focus next: risk management. Drawdown is high; consider tighter stoploss, fewer open trades, or a trend filter.";
    }
    if (p != null && p > 0 && wr != null && wr < 0.35) {
      return "Focus next: stability. Profit relies on a few big winners; consider reducing losing streaks with better filters.";
    }
    return "Focus next: validate robustness (different timeranges) and then tune parameters carefully (small steps).";
  };

  const fetchBacktest = async (id: number): Promise<any> => {
    const url = buildUrl(api.backtests.get.path, { id });
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) throw new Error("Failed to fetch backtest status");
    return res.json();
  };

  const stopRefinementPolling = () => {
    if (refinementPollerRef.current != null) {
      window.clearInterval(refinementPollerRef.current);
      refinementPollerRef.current = null;
    }
    refinementPollInFlightRef.current = false;
  };

  const startRefinementPolling = (strategyName: string, ids: number[], type: RefinementRunType) => {
    stopRefinementPolling();
    const initial: RefinementState = {
      type,
      stage: "running",
      startedAt: Date.now(),
      updatedAt: Date.now(),
      strategyName,
      ids,
      completedIds: [],
      lastLogLine: null,
      summaries: [],
    };
    announcedCompletedRef.current = new Set();
    refinementRef.current = initial;
    setRefinement(initial);

    const pollOnce = async () => {
      if (refinementPollInFlightRef.current) return;
      refinementPollInFlightRef.current = true;
      try {
        const current = refinementRef.current;
        const base = current?.ids?.length ? current : { ids, completedIds: [], summaries: [], lastLogLine: null };
        const doneSet = new Set<number>(base.completedIds || []);
        const pending = (base.ids || ids).filter((x: number) => !doneSet.has(x));
        if (pending.length === 0) {
          refinementPollInFlightRef.current = false;
          return;
        }

        const updates = await Promise.all(
          pending.map(async (bid: number) => {
            try {
              return await fetchBacktest(bid);
            } catch {
              return null;
            }
          }),
        );

        const completedNow: number[] = [];
        const summariesNow: BacktestSummary[] = [];
        const failedNow: number[] = [];
        let lastLogLine: string | null = base.lastLogLine || null;

        for (const bt of updates) {
          if (!bt) continue;
          const logs = Array.isArray(bt?.logs) ? (bt.logs as unknown[]) : [];
          const candidate = logs.length ? String(logs[logs.length - 1] ?? "").trim() : "";
          if (candidate) {
            lastLogLine = candidate.length > 220 ? candidate.slice(-220) : candidate;
          }

          const bid = Number(bt?.id);
          const status = String(bt?.status || "");
          const hasResults = Boolean(bt?.results);
          if (Number.isFinite(bid) && status === "failed") {
            completedNow.push(bid);
            failedNow.push(bid);
          }
          if (Number.isFinite(bid) && status === "completed" && hasResults) {
            completedNow.push(bid);
            const s = buildBacktestSummary(bt);
            if (s) summariesNow.push(s);
          }
        }

        if (failedNow.length) {
          for (const id of failedNow) {
            if (announcedCompletedRef.current.has(id)) continue;
            announcedCompletedRef.current.add(id);
            pushMessage("assistant", `Backtest ${id} failed. Check the log output above and the Backtests panel for details.`);
          }
        }

        if (completedNow.length) {
          setRefinement((prev) => {
            if (!prev) return prev;
            const prevDone = new Set(prev.completedIds);
            const nextDone = [...prev.completedIds];
            for (const id of completedNow) {
              if (!prevDone.has(id)) nextDone.push(id);
            }
            const prevSumm = new Map(prev.summaries.map((s) => [s.id, s] as const));
            for (const s of summariesNow) {
              prevSumm.set(s.id, s);
            }
            const next: RefinementState = {
              ...prev,
              updatedAt: Date.now(),
              completedIds: nextDone,
              lastLogLine,
              summaries: Array.from(prevSumm.values()),
            };
            refinementRef.current = next;
            return next;
          });

          for (const s of summariesNow) {
            if (announcedCompletedRef.current.has(s.id)) continue;
            announcedCompletedRef.current.add(s.id);
            const pPct = s.profitTotal == null ? "N/A" : `${(s.profitTotal * 100).toFixed(2)}%`;
            const wrPct = s.winRate == null ? "N/A" : `${(s.winRate * 100).toFixed(1)}%`;
            const ddPct = s.maxDrawdown == null ? "N/A" : `${(s.maxDrawdown * 100).toFixed(2)}%`;
            const tr = s.totalTrades == null ? "N/A" : String(s.totalTrades);
            pushMessage(
              "assistant",
              [
                `Backtest ${s.id} finished.`,
                `- Profit: ${pPct}`,
                `- Win Rate: ${wrPct}`,
                `- Max Drawdown: ${ddPct}`,
                `- Trades: ${tr}`,
                explainNextFocus(s),
              ].join("\n"),
            );
          }
        }

        let finalized = false;
        setRefinement((prev) => {
          if (!prev) return prev;
          const nextStage = failedNow.length ? "failed" : prev.stage;
          const allDone = prev.ids.length > 0 && prev.completedIds.length >= prev.ids.length;
          if (!allDone) {
            const next: RefinementState = { ...prev, stage: nextStage as RefinementStage, updatedAt: Date.now(), lastLogLine };
            refinementRef.current = next;
            return next;
          }
          finalized = true;
          const next: RefinementState = { ...prev, stage: nextStage === "failed" ? "failed" : "completed", updatedAt: Date.now(), lastLogLine };
          refinementRef.current = next;
          return next;
        });

        if (finalized) {
          stopRefinementPolling();

          const final = refinementRef.current;
          if (final && autoExplain && selectedModel) {
            if (final.type === "single" && final.summaries.length === 1) {
              const s = final.summaries[0];
              const pPct = s.profitTotal == null ? "N/A" : `${(s.profitTotal * 100).toFixed(2)}%`;
              const wrPct = s.winRate == null ? "N/A" : `${(s.winRate * 100).toFixed(1)}%`;
              const ddPct = s.maxDrawdown == null ? "N/A" : `${(s.maxDrawdown * 100).toFixed(2)}%`;
              const tr = s.totalTrades == null ? "N/A" : String(s.totalTrades);
              const prompt = [
                `We just finished a refinement backtest (ID ${s.id}) for strategy '${strategyName}'.`,
                `Metrics: profit=${pPct}, win_rate=${wrPct}, max_drawdown=${ddPct}, trades=${tr}.`,
                "Explain what these results mean, what is likely wrong/right in the strategy logic, and propose the next refinement step.",
              ].join("\n");
              setMessages((prev) => [
                ...prev,
                {
                  id: createMessageId(),
                  role: "user",
                  content: prompt,
                  timestamp: new Date(),
                },
              ]);
              chatMutation.mutate(prompt);
            }

            if (final.type === "batch" && final.summaries.length) {
              const lines = final.summaries
                .slice()
                .sort((a, b) => a.id - b.id)
                .map((s) => {
                  const pPct = s.profitTotal == null ? "N/A" : `${(s.profitTotal * 100).toFixed(2)}%`;
                  const wrPct = s.winRate == null ? "N/A" : `${(s.winRate * 100).toFixed(1)}%`;
                  const ddPct = s.maxDrawdown == null ? "N/A" : `${(s.maxDrawdown * 100).toFixed(2)}%`;
                  const tr = s.totalTrades == null ? "N/A" : String(s.totalTrades);
                  return `- ${s.id}: profit=${pPct}, win_rate=${wrPct}, drawdown=${ddPct}, trades=${tr}`;
                });
              const prompt = [
                `We just finished a refinement batch for strategy '${strategyName}'.`,
                "Summaries:",
                ...lines,
                "Compare the runs, describe stability/robustness, and propose the next refinement step.",
              ].join("\n");
              setMessages((prev) => [
                ...prev,
                {
                  id: createMessageId(),
                  role: "user",
                  content: prompt,
                  timestamp: new Date(),
                },
              ]);
              chatMutation.mutate(prompt);
            }
          }
        }
      } finally {
        refinementPollInFlightRef.current = false;
      }
    };

    refinementPollerRef.current = window.setInterval(() => {
      pollOnce().catch(() => {});
    }, 1500);

    pollOnce().catch(() => {});
  };

  const summarizeConfig = (cfg: any): string => {
    if (!cfg || typeof cfg !== "object") return "";
    const tf = cfg.timeframe ? String(cfg.timeframe) : "";
    const pairs = Array.isArray(cfg.pairs) ? cfg.pairs : null;
    const from = cfg.backtest_date_from ? String(cfg.backtest_date_from) : "";
    const to = cfg.backtest_date_to ? String(cfg.backtest_date_to) : "";
    const timerange = cfg.timerange ? String(cfg.timerange) : "";
    const parts: string[] = [];
    if (tf) parts.push(`timeframe=${tf}`);
    if (timerange) parts.push(`timerange=${timerange}`);
    if (from || to) parts.push(`range=${from || "?"} → ${to || "?"}`);
    if (pairs && pairs.length) parts.push(`pairs=${pairs.length}`);
    return parts.length ? parts.join(", ") : "";
  };

  const runBacktestNarrated = async (payload: any) => {
    const strategyName = String(payload?.strategyName || "");
    const cfgText = summarizeConfig(payload?.config);
    pushMessage(
      "assistant",
      [
        `Refinement: starting a backtest for '${strategyName}'.`,
        cfgText ? `Config: ${cfgText}` : "",
        "Status: preparing run. Estimated time: typically 2–6 minutes depending on timerange/pairs.",
      ]
        .filter(Boolean)
        .join("\n"),
    );
    setRefinement({
      type: "single",
      stage: "starting",
      startedAt: Date.now(),
      updatedAt: Date.now(),
      strategyName,
      ids: [],
      completedIds: [],
      lastLogLine: null,
      summaries: [],
    });
    try {
      const data = await runBacktestMutation.mutateAsync(payload);
      const id = Number(data?.id);
      if (!Number.isFinite(id)) {
        pushMessage("assistant", "Backtest started, but no backtest ID was returned.");
        setRefinement(null);
        return;
      }
      pushMessage("assistant", `Backtest started (ID ${id}). Status: running…`);
      startRefinementPolling(strategyName, [id], "single");
    } catch (e: any) {
      pushMessage("assistant", `Error running backtest: ${e?.message || "Failed to run backtest"}`);
      setRefinement((prev) => (prev ? { ...prev, stage: "failed", updatedAt: Date.now() } : prev));
      stopRefinementPolling();
    }
  };

  const runBatchNarrated = async (payload: any) => {
    const strategyName = String(payload?.strategyName || "");
    const cfgText = summarizeConfig(payload?.baseConfig);
    const countGuess = Array.isArray(payload?.ranges)
      ? payload.ranges.length
      : (payload?.rolling?.count ?? 4);
    pushMessage(
      "assistant",
      [
        `Refinement: starting a batch backtest for '${strategyName}' (${countGuess} runs).`,
        cfgText ? `Base config: ${cfgText}` : "",
        "Status: preparing batch. Estimated time: roughly 2–6 minutes per run.",
      ]
        .filter(Boolean)
        .join("\n"),
    );
    setRefinement({
      type: "batch",
      stage: "starting",
      startedAt: Date.now(),
      updatedAt: Date.now(),
      strategyName,
      ids: [],
      completedIds: [],
      lastLogLine: null,
      summaries: [],
    });
    try {
      const data = await runBatchMutation.mutateAsync(payload);
      const ids = Array.isArray(data?.backtests) ? data.backtests.map((b: any) => Number(b?.id)).filter((x: any) => Number.isFinite(x)) : [];
      if (!ids.length) {
        pushMessage("assistant", "Batch started, but no backtest IDs were returned.");
        setRefinement(null);
        return;
      }
      pushMessage("assistant", `Batch started (${data?.batchId ?? "?"}). Tracking ${ids.length} runs: ${ids.join(", ")}`);
      startRefinementPolling(strategyName, ids, "batch");
    } catch (e: any) {
      pushMessage("assistant", `Error running batch: ${e?.message || "Failed to run batch"}`);
      setRefinement((prev) => (prev ? { ...prev, stage: "failed", updatedAt: Date.now() } : prev));
      stopRefinementPolling();
    }
  };

  const chatMutation = useMutation({
    mutationFn: async (message: string) => {
      const cursorFunctionNameForRequest =
        (typeof context.cursorFunctionName === "string" && context.cursorFunctionName.trim())
          ? context.cursorFunctionName.trim()
          : inferEnclosingPythonFunctionNameFromFile(context.fileContent, context.lineNumber) || undefined;
      const res = await apiRequest("POST", "/api/ai/chat", {
        message,
        model: selectedModel,
        context: {
          fileName: context.fileName,
          fileContent: context.fileContent,
          selectedCode: context.selectedCode,
          lineNumber: context.lineNumber,
          cursorFunctionName: cursorFunctionNameForRequest,
          lastBacktest: context.lastBacktest,
          backtestResults: context.backtestResults,
        },
      });
      return res.json();
    },
    onSuccess: (data: { response: string }) => {
      setMessages((prev) => [
        ...prev,
        {
          id: createMessageId(),
          role: "assistant",
          content: data.response,
          timestamp: new Date(),
        },
      ]);
      // Optional: Auto-scroll is handled by useEffect
    },
    onError: (error: any) => {
      setMessages((prev) => [
        ...prev,
        {
          id: createMessageId(),
          role: "assistant",
          content: `Error: ${error.message || "Failed to get AI response."}`,
          timestamp: new Date(),
        },
      ]);
    }
  });

  const runBacktestMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await apiRequest("POST", api.backtests.run.path, payload);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: [api.backtests.list.path] }).catch(() => {});
    },
    onError: (error: any) => {
      setMessages((prev) => [
        ...prev,
        {
          id: createMessageId(),
          role: "assistant",
          content: `Error running backtest: ${error?.message || "Failed to run backtest"}`,
          timestamp: new Date(),
        },
      ]);
    },
  });

  const runBatchMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await apiRequest("POST", api.backtests.batchRun.path, payload);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: [api.backtests.list.path] }).catch(() => {});
    },
    onError: (error: any) => {
      setMessages((prev) => [
        ...prev,
        {
          id: createMessageId(),
          role: "assistant",
          content: `Error running batch: ${error?.message || "Failed to run batch"}`,
          timestamp: new Date(),
        },
      ]);
    },
  });

  useEffect(() => {
    const handleAttach = (e: any) => {
      setInput(prev => prev + (prev ? "\n\n" : "") + e.detail);
    };
    window.addEventListener('attach-backtest-results', handleAttach);
    return () => window.removeEventListener('attach-backtest-results', handleAttach);
  }, []);

  useEffect(() => {
    return () => {
      stopRefinementPolling();
    };
  }, []);

  useEffect(() => {
    refinementRef.current = refinement;
  }, [refinement]);

  useEffect(() => {
    try {
      localStorage.setItem("chat:autoExplainRefinement", String(autoExplain));
    } catch {
    }
  }, [autoExplain]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = () => {
    if (!input.trim() || chatMutation.isPending) return;

    const userMessage: Message = {
      id: createMessageId(),
      role: "user",
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    chatMutation.mutate(input.trim());
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div 
      data-testid="panel-chat"
      className="h-full w-[320px] bg-card border-l border-border/50 flex flex-col overflow-hidden transition-all duration-300 ease-in-out animate-in slide-in-from-right-4"
    >
      <div className="flex items-center justify-between gap-2 p-3 border-b border-border/50 bg-background">
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5 text-primary" />
          <span className="font-semibold text-sm">AI Assistant</span>
        </div>
        <Button
          data-testid="button-close-chat"
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={onToggle}
          title="Hide chat panel"
        >
          <PanelRightClose className="w-4 h-4" />
        </Button>
      </div>

      {context.fileName && (
        <div className="px-3 py-2 border-b border-border/30 bg-primary/5">
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-muted-foreground min-w-0">
              <FileCode className="w-3 h-3 text-primary" />
              <span className="truncate font-medium">{context.fileName.split('/').pop()}</span>
              {context.lineNumber && (
                <span className="text-[10px] bg-secondary/50 px-1 rounded border border-border/20 shrink-0">
                  L{context.lineNumber}
                </span>
              )}
            </div>
            {context.backtestResults && (
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 hover:bg-primary/20 hover:text-primary shrink-0 ml-1"
                title="Attach Backtest Results to message"
                onClick={() => {
                  const results = context.backtestResults!;
                  const resultText = `\n\nBacktest Results for context:\n- Profit Total: ${results.profit_total.toFixed(2)}%\n- Win Rate: ${results.win_rate.toFixed(2)}%\n- Max Drawdown: ${results.max_drawdown.toFixed(2)}%\n- Total Trades: ${results.total_trades}${results.sharpe ? `\n- Sharpe Ratio: ${results.sharpe.toFixed(2)}` : ""}`;
                  setInput(prev => prev + resultText);
                }}
              >
                <BarChart3 className="w-3 h-3" />
              </Button>
            )}

            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-2 text-[10px] hover:bg-primary/20 hover:text-primary shrink-0 ml-1"
              title="When enabled, the chat will automatically ask the AI to interpret completed backtests."
              onClick={() => setAutoExplain((v) => !v)}
            >
              Auto Explain: {autoExplain ? "On" : "Off"}
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 hover:bg-primary/20 hover:text-primary shrink-0 ml-1"
              title="Ask AI to add a TA indicator pack (RSI/EMA/MACD/BB/ATR/ADX/Volume)"
              onClick={() => {
                const text = [
                  "Add a TA indicator pack to populate_indicators for this strategy:",
                  "- RSI(14)",
                  "- EMA(20), EMA(50)",
                  "- MACD(12,26,9)",
                  "- Bollinger Bands(20,2)",
                  "- ATR(14)",
                  "- ADX(14)",
                  "- Volume SMA(20) and volume ratio",
                  "Return the updated populate_indicators function only (keep function name).",
                  "Do not change entry/exit rules unless asked.",
                ].join("\n");
                setInput((prev) => prev + (prev ? "\n\n" : "") + text);
              }}
            >
              <Zap className="w-3 h-3" />
            </Button>
          </div>
            {context.selectedCode && (
              <div className="flex items-center gap-1.5 text-[10px] text-primary bg-primary/5 px-1.5 py-0.5 rounded border border-primary/10">
                <Code className="w-2.5 h-2.5" />
                <span>Selected: {context.selectedCode.split('\n').length} lines</span>
              </div>
            )}
          </div>
        </div>
      )}

      {refinement && refinement.stage !== "idle" && (
        <div className="px-3 py-2 border-b border-border/30 bg-background">
          <div className="rounded-md border border-border/40 bg-muted/30 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-medium">
                {(refinement.stage === "running" || refinement.stage === "starting") ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : null}
                <span>
                  Refinement Status: {refinement.stage}
                  {refinement.type === "batch" ? ` (${refinement.completedIds.length}/${refinement.ids.length})` : ""}
                </span>
              </div>
              <div className="text-[10px] text-muted-foreground">
                {(() => {
                  const elapsed = Date.now() - refinement.startedAt;
                  const remaining = estimateRemainingMs(refinement);
                  const remainingText =
                    remaining == null
                      ? ""
                      : (remaining === 0 ? " · Remaining: 0m 0s" : ` · Remaining: ~${formatDuration(remaining)}`);
                  return `Elapsed: ${formatDuration(elapsed)}${remainingText}`;
                })()}
              </div>
            </div>
            {refinement.lastLogLine && (
              <div className="mt-1 text-[10px] text-muted-foreground whitespace-pre-wrap break-words">
                {refinement.lastLogLine}
              </div>
            )}
          </div>
        </div>
      )}

      <ScrollArea ref={scrollRef} className="flex-1 p-3">
        <div className="space-y-4">
          {messages.length === 0 && (
            <div className="text-center text-muted-foreground text-sm py-8 space-y-4">
              <Bot className="w-10 h-10 mx-auto mb-3 opacity-30" />
              {context.selectedCode && (
                <div className="mt-2 p-2 bg-primary/5 border border-primary/20 rounded text-[10px] text-primary">
                  <div className="flex items-center gap-1 mb-1 font-semibold uppercase">
                    <Code className="w-2.5 h-2.5" />
                    Context: Selected Snippet
                  </div>
                  <pre className="truncate opacity-70 italic">"{context.selectedCode.substring(0, 100)}..."</pre>
                </div>
              )}
              <p className="text-xs mt-2 text-muted-foreground max-w-[240px] mx-auto">
                I can help you generate code, refactor logic, debug issues, and document your trading strategies.
              </p>
              <Button 
                variant="outline" 
                size="sm" 
                className="h-8 text-[10px] gap-1.5 hover-elevate"
                onClick={() => {
                  const demoCode = "```python\n# Optimized RSI strategy\ndef populate_indicators(self, dataframe, metadata):\n    dataframe['rsi'] = ta.RSI(dataframe, timeperiod=14)\n    return dataframe\n```";
                  setMessages([{
                    id: crypto.randomUUID(),
                    role: "assistant",
                    content: "I've analyzed your RSI logic. Here is a more robust implementation with standard parameters:\n\n" + demoCode,
                    timestamp: new Date()
                  }]);
                }}
              >
                <Zap className="w-3.5 h-3.5 text-primary" />
                Show Demo Suggestion
              </Button>
            </div>
          )}
          {messages.map((message) => (
            <div
              key={message.id}
              data-testid={`message-${message.role}-${message.id}`}
              className={cn(
                "flex gap-2",
                message.role === "user" ? "justify-end" : "justify-start"
              )}
            >
              {message.role === "assistant" && (
                <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Bot className="w-3 h-3 text-primary" />
                </div>
              )}
              <div className="flex flex-col gap-2 max-w-[85%]">
                <div
                  className={cn(
                    "rounded-lg px-3 py-2 text-sm",
                    message.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted"
                  )}
                >
                  <pre className="whitespace-pre-wrap font-sans">
                    {message.content.split(/(```[\s\S]*?```)/).map((part, i) => {
                      if (part.startsWith('```')) {
                        return <code key={i} className="block bg-black/30 p-2 rounded my-2 overflow-x-auto border border-border/30">{part.replace(/```[a-z]*\n|```/g, '')}</code>;
                      }
                      return part;
                    })}
                  </pre>
                </div>
                {message.role === "assistant" && (onApplyCode || onApplyConfig) && extractCodeBlocks(message.content).length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {extractCodeBlocks(message.content).map((block, idx) => {
                      const patch = onApplyConfig ? parseConfigPatch(block) : null;
                      const action = parseActionBlock(block);
                      const hasConfigPatch = patch != null && Object.keys(patch).length > 0;
                      const hasAction = Boolean(action);
                      const allowApplyToEditor = Boolean(onApplyCode) && !hasConfigPatch && !hasAction;
                      const mismatchWarning = shouldWarnFunctionMismatch(context.selectedCode, cursorFunctionName, block);
                      const snippetFn = inferPythonFunctionName(block.code);
                      const canReplaceEnclosing =
                        !hasSelection &&
                        Boolean(cursorFunctionName) &&
                        Boolean(snippetFn) &&
                        cursorFunctionName === snippetFn;
                      const applyMode: "selection" | "cursor" | "enclosingFunction" = hasSelection
                        ? "selection"
                        : (canReplaceEnclosing ? "enclosingFunction" : "cursor");

                      return (
                        <div key={idx} className="flex gap-2">
                          {hasAction && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-[10px] gap-1.5 bg-background hover-elevate"
                              disabled={runBacktestMutation.isPending || runBatchMutation.isPending}
                              onClick={() => {
                                if (!action) return;

                                if (action.action === "run_backtest") {
                                  const baseCfg = (context.lastBacktest && context.lastBacktest.config) ? context.lastBacktest.config : {};
                                  const strategyName =
                                    (action.payload && action.payload.strategyName) ||
                                    (context.lastBacktest && context.lastBacktest.strategyName) ||
                                    "";
                                  const cfgPatch = action.payload && action.payload.config ? action.payload.config : {};
                                  const payload = {
                                    strategyName,
                                    config: { ...baseCfg, ...cfgPatch },
                                  };

                                  const ok = confirm("Run this backtest now?");
                                  if (!ok) return;
                                  runBacktestNarrated(payload);
                                  return;
                                }

                                if (action.action === "run_batch_backtest") {
                                  const baseCfg = (context.lastBacktest && context.lastBacktest.config) ? context.lastBacktest.config : {};
                                  const strategyName =
                                    (action.payload && action.payload.strategyName) ||
                                    (context.lastBacktest && context.lastBacktest.strategyName) ||
                                    "";

                                  const payload = {
                                    strategyName,
                                    baseConfig: { ...baseCfg, ...(action.payload?.baseConfig || {}) },
                                    ranges: action.payload?.ranges,
                                    rolling: action.payload?.rolling,
                                    batchId: action.payload?.batchId,
                                  };

                                  const countGuess = Array.isArray(payload.ranges)
                                    ? payload.ranges.length
                                    : (payload.rolling?.count ?? 4);
                                  const ok = confirm(`Run batch backtest now? (about ${countGuess} runs)`);
                                  if (!ok) return;
                                  runBatchNarrated(payload);
                                  return;
                                }

                                alert(`Unknown action: ${String((action as any).action)}`);
                              }}
                            >
                              <BarChart3 className="w-3 h-3" />
                              Run
                            </Button>
                          )}
                          {allowApplyToEditor && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-[10px] gap-1.5 bg-background hover-elevate"
                              onClick={() => {
                                const currentLabel =
                                  applyMode === "selection"
                                    ? "Selected"
                                    : (applyMode === "enclosingFunction" ? `Function '${cursorFunctionName ?? ""}'` : "Cursor Context");
                                const current =
                                  applyMode === "selection"
                                    ? String(context.selectedCode || "")
                                    : (applyMode === "enclosingFunction"
                                      ? (enclosingFunctionBlock?.code ?? getCursorContextSnippet(context.fileContent, context.lineNumber))
                                      : getCursorContextSnippet(context.fileContent, context.lineNumber));
                                const title =
                                  applyMode === "selection"
                                    ? "Preview: Replace Selection"
                                    : (applyMode === "enclosingFunction" ? "Preview: Replace Current Function" : "Preview: Insert at Cursor");

                                setPreview({
                                  title,
                                  mode: applyMode,
                                  currentLabel,
                                  current,
                                  proposed: block.code,
                                  mismatchWarning,
                                });
                              }}
                            >
                              <Eye className="w-3 h-3" />
                              Preview
                            </Button>
                          )}
                          {allowApplyToEditor && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-[10px] gap-1.5 bg-background hover-elevate"
                              onClick={() => {
                                if (!hasSelection) {
                                  if (canReplaceEnclosing) {
                                    const ok = confirm(`Replace current function '${cursorFunctionName}' with this snippet?`);
                                    if (!ok) return;
                                  } else {
                                    const ok = confirm("No code is selected. Insert this snippet at the current cursor position?");
                                    if (!ok) return;
                                  }
                                }
                                if (mismatchWarning) {
                                  const ok = confirm(mismatchWarning);
                                  if (!ok) return;
                                }
                                onApplyCode?.(block.code, applyMode);
                              }}
                            >
                              <Code className="w-3 h-3" />
                              {hasSelection ? "Replace Selection" : (canReplaceEnclosing ? "Replace Current Function" : "Insert at Cursor")}
                            </Button>
                          )}
                          {allowApplyToEditor && canApplyAndSave && Boolean(onApplyAndSaveCode) && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-[10px] gap-1.5 bg-background hover-elevate"
                              onClick={() => {
                                if (!hasSelection) {
                                  if (canReplaceEnclosing) {
                                    const ok = confirm(`Replace current function '${cursorFunctionName}' with this snippet?`);
                                    if (!ok) return;
                                  } else {
                                    const ok = confirm("No code is selected. Insert this snippet at the current cursor position?");
                                    if (!ok) return;
                                  }
                                }
                                if (mismatchWarning) {
                                  const ok = confirm(mismatchWarning);
                                  if (!ok) return;
                                }
                                const ok = confirm("Apply this change and save the strategy file now?");
                                if (!ok) return;
                                onApplyAndSaveCode?.(block.code, applyMode);
                              }}
                            >
                              <Save className="w-3 h-3" />
                              Apply & Save
                            </Button>
                          )}
                          {hasConfigPatch && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-[10px] gap-1.5 bg-background hover-elevate"
                              onClick={() => onApplyConfig?.(patch)}
                            >
                              <FileCode className="w-3 h-3" />
                              Apply Config
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              {message.role === "user" && (
                <div className="w-6 h-6 rounded-full bg-secondary flex items-center justify-center flex-shrink-0">
                  <User className="w-3 h-3" />
                </div>
              )}
            </div>
          ))}
          {chatMutation.isPending && (
            <div className="flex gap-2 justify-start animate-in fade-in slide-in-from-left-2 duration-300">
              <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Bot className="w-3 h-3 text-primary" />
              </div>
              <div className="rounded-lg px-3 py-2 text-sm bg-muted flex items-center gap-2">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span className="text-xs text-muted-foreground">Thinking...</span>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      <Dialog open={Boolean(preview)} onOpenChange={(open) => (!open ? setPreview(null) : undefined)}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>{preview?.title ?? "Preview"}</DialogTitle>
            {preview?.mismatchWarning ? (
              <DialogDescription className="text-destructive">{preview.mismatchWarning}</DialogDescription>
            ) : (
              <DialogDescription>Review the change below before applying.</DialogDescription>
            )}
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="border border-border/40 rounded-md overflow-hidden">
              <div className="px-3 py-2 text-xs font-medium bg-muted/50 border-b border-border/40">
                {preview?.currentLabel ?? "Current"}
              </div>
              <pre className="p-3 text-xs font-mono whitespace-pre overflow-auto max-h-[55vh] bg-black/20">
                {preview?.current || ""}
              </pre>
            </div>
            <div className="border border-border/40 rounded-md overflow-hidden">
              <div className="px-3 py-2 text-xs font-medium bg-muted/50 border-b border-border/40">AI Proposed</div>
              <pre className="p-3 text-xs font-mono whitespace-pre overflow-auto max-h-[55vh] bg-black/20">
                {preview?.proposed || ""}
              </pre>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPreview(null)}>
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                if (!preview) return;
                onApplyCode?.(preview.proposed, preview.mode);
                setPreview(null);
              }}
              disabled={!onApplyCode}
            >
              Apply
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                if (!preview) return;
                onApplyAndSaveCode?.(preview.proposed, preview.mode);
                setPreview(null);
              }}
              disabled={!canApplyAndSave || !onApplyAndSaveCode}
            >
              Apply & Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="p-3 border-t border-border/50 bg-background">
        <div className="flex gap-2">
          <Textarea
            data-testid="textarea-chat-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your strategy, backtests, or request code changes..."
            className="min-h-[60px] resize-none text-sm"
          />
          <Button
            data-testid="button-send-message"
            size="icon"
            onClick={handleSend}
            disabled={!input.trim() || chatMutation.isPending}
            className="h-[60px] w-10 flex-shrink-0"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
        {context.lineNumber && (
          <div className="mt-2 text-xs text-muted-foreground flex items-center gap-1">
            <span>Line {context.lineNumber}</span>
          </div>
        )}
      </div>
    </div>
  );
}
