import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageSquare, X, Send, Loader2, Bot, User, Code, FileCode, Save, PanelRightClose, PanelRightOpen, Zap, BarChart3, Eye, Check, ChevronDown, RefreshCw, Database, Sparkles, TrendingUp, Shield, Target } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { useAIModels, useAIStore, useResolvedAIModel } from "@/hooks/use-ai";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, buildUrl } from "@shared/routes";
import { AIActionTimeline } from "@/components/ai/AIActionTimeline";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { reportErrorOnce } from "@/lib/reportError";
import { MentionMenu, MentionItem, defaultMentionItems } from "@/components/MentionMenu";

interface ChatContext {
  fileName?: string;
  fileContent?: string;
  selectedCode?: string;
  lineNumber?: number;
  columnNumber?: number;
  cursorFunctionName?: string;
  lastBacktest?: {
    id?: number;
    strategyName?: string;
    config?: any;
    status?: string;
    error?: string;
    logTail?: string;
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
  } catch (e) {
    console.error("createMessageId failed:", e);
  }

  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
}

type ApplyMode = "selection" | "cursor" | "enclosingFunction" | "namedFunction";

interface ChatPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  context: ChatContext;
  onApplyCode?: (code: string, mode?: ApplyMode) => void;
  onApplyConfig?: (patch: Record<string, unknown>) => void;
  onApplyAndSaveCode?: (code: string, mode?: ApplyMode) => void;
  onPreviewValidatedEdit?: (payload: { strategyPath: string; edits: any[]; dryRun?: boolean }) => Promise<any>;
}

export function ChatToggleButton({ isOpen, onToggle }: { isOpen: boolean; onToggle: () => void }) {
  return (
    <Button
      data-testid="button-toggle-chat"
      size="icon"
      variant="ghost"
      onClick={onToggle}
      className={cn(
        "toggle-elevate relative overflow-hidden",
        "border border-border/40 bg-background/60 backdrop-blur",
        "shadow-sm hover:shadow-md",
        "after:absolute after:inset-0 after:bg-gradient-to-br after:from-primary/10 after:via-transparent after:to-primary/5 after:opacity-0 hover:after:opacity-100 after:transition-opacity",
      )}
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
  | { action: "run_backtest"; payload: any; label?: string }
  | { action: "run_batch_backtest"; payload: any; label?: string }
  | { action: "run_diagnostic"; payload: any; label?: string }
  | { action: string; payload: any; label?: string };

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
    const label = typeof (parsed as any).label === "string" ? String((parsed as any).label) : undefined;
    return { action: action as any, payload, label };
  } catch (e) {
    reportErrorOnce("chat:parseActionBlock", "Failed to parse action block", e, { showToast: false });
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

const parseChoiceBlocks = (content: string): Array<{ label: string; value: string }> => {
  const text = String(content || "");
  const idx = text.toLowerCase().indexOf("choices:");
  if (idx === -1) return [];
  const after = text.slice(idx + "choices:".length);
  const lines = after.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out: Array<{ label: string; value: string }> = [];
  for (const line of lines) {
    const m = line.match(/^(\d+)\)\s+(.*)$/);
    if (!m) {
      // Stop once we leave the numbered block
      if (out.length > 0) break;
      continue;
    }
    const n = m[1];
    const value = String(m[2] || "").trim();
    if (!value) continue;
    out.push({ label: n, value });
    if (out.length >= 4) break;
  }
  return out.length >= 2 ? out : [];
};

const isLikelyEditablePythonSuggestion = (block: ExtractedBlock): boolean => {
  const lang = String(block.lang || "").toLowerCase();
  if (lang !== "python" && lang !== "py") return false;
  const code = String(block.code || "");
  const nonEmptyLines = code.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (nonEmptyLines.length === 0) return false;
  const nonComment = nonEmptyLines.filter((l) => !l.trim().startsWith("#"));
  if (nonComment.length === 0) return false; // comments-only examples shouldn't show apply buttons
  // Heuristic: prefer apply buttons for real strategy blocks (functions/classes) or substantial logic.
  if (/\bdef\s+[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(code)) return true;
  if (/\bclass\s+[A-Za-z_][A-Za-z0-9_]*\b/.test(code)) return true;
  if (nonComment.length >= 6) return true;
  return false;
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

const inferSingleFunctionName = (src: string): string | null => {
  const text = String(src || "");
  if (/\bclass\s+[A-Za-z_][A-Za-z0-9_]*\b/.test(text)) return null;
  const defs = text.match(/\bdef\s+[A-Za-z_][A-Za-z0-9_]*\s*\(/g) || [];
  if (defs.length !== 1) return null;
  return inferPythonFunctionName(text);
};

const leadingIndent = (line: string) => {
  const m = String(line || "").match(/^\s*/);
  return m?.[0]?.length ?? 0;
};

const leadingIndentStr = (line: string) => {
  const m = String(line || "").match(/^[\t ]*/);
  return m?.[0] ?? "";
};

const dedentBlock = (src: string): string => {
  const text = String(src || "").replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  let min = Infinity;
  for (const line of lines) {
    if (!String(line).trim()) continue;
    const ind = leadingIndentStr(line).length;
    if (ind < min) min = ind;
  }
  if (!Number.isFinite(min) || min <= 0) return text;
  return lines
    .map((line) => {
      if (!String(line).trim()) return line;
      return line.slice(min);
    })
    .join("\n");
};

const reindentBlockTo = (src: string, targetIndent: string): string => {
  const base = dedentBlock(src);
  const lines = String(base || "").replace(/\r\n/g, "\n").split("\n");
  return lines
    .map((line) => {
      if (!String(line).trim()) return line;
      return `${targetIndent}${line}`;
    })
    .join("\n");
};

const inferStrategyMethodIndentFromFile = (fileContent: string | undefined): string => {
  const src = typeof fileContent === "string" ? fileContent : "";
  if (!src) return "    ";
  const lines = src.split(/\r?\n/);

  for (const line of lines) {
    if (/^\s*def\s+populate_indicators\s*\(/.test(line)) {
      return leadingIndentStr(line);
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!/^\s*class\s+[A-Za-z_][A-Za-z0-9_]*\s*[(:]/.test(line)) continue;
    const classIndent = leadingIndentStr(line);
    for (let j = i + 1; j < lines.length; j++) {
      const l2 = lines[j] ?? "";
      if (!String(l2).trim()) continue;
      const ind2 = leadingIndentStr(l2);
      if (ind2.length <= classIndent.length) break;
      if (/^\s*def\s+[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(l2)) return ind2;
    }
  }

  return "    ";
};

const isPythonDefLine = (line: string) => /^\s*def\s+[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(String(line || ""));
const isPythonDecoratorLine = (line: string) => /^\s*@/.test(String(line || ""));
const isPythonClassLine = (line: string) => /^\s*class\s+[A-Za-z_][A-Za-z0-9_]*\s*[(:]/.test(String(line || ""));

const findSelectionRangeFromFile = (
  fileContent: string | undefined,
  selectedCode: string | undefined,
): { startLine: number; endLine: number; before: string } | null => {
  const src = typeof fileContent === "string" ? fileContent : "";
  const sel = typeof selectedCode === "string" ? selectedCode : "";
  if (!src.trim() || !sel.trim()) return null;

  const idx = src.indexOf(sel);
  if (idx < 0) return null;
  const idx2 = src.indexOf(sel, idx + Math.max(1, sel.length));
  if (idx2 >= 0) return null;

  const beforeChar = idx > 0 ? src[idx - 1] : "";
  const endIdx = idx + sel.length;
  const afterChar = endIdx < src.length ? src[endIdx] : "";
  const endOnNewline = sel.endsWith("\n") || sel.endsWith("\r\n");
  const alignedStart = idx === 0 || beforeChar === "\n";
  const alignedEnd = endIdx === src.length || afterChar === "\n" || endOnNewline;
  if (!alignedStart || !alignedEnd) return null;

  const beforeText = src.slice(0, idx);
  const startLine = beforeText.split(/\r?\n/).length;
  const parts = sel.split(/\r?\n/);
  const lineCount = parts.length - (endOnNewline ? 1 : 0);
  const endLine = Math.max(startLine, startLine + Math.max(1, lineCount) - 1);

  return { startLine, endLine, before: sel };
};

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

const inferPythonFunctionBlockByNameFromFile = (
  fileContent: string | undefined,
  fnName: string | null | undefined,
): { name: string; startLine: number; endLine: number; code: string } | null => {
  const name = String(fnName || "").trim();
  if (!fileContent || !name) return null;
  const lines = String(fileContent).split(/\r?\n/);
  const total = lines.length;
  if (!total) return null;

  const isTargetDef = (line: string) => new RegExp(`^\\s*def\\s+${name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\s*\\(`).test(line);

  let defLine = -1;
  for (let i = 1; i <= total; i++) {
    if (isTargetDef(lines[i - 1] ?? "")) {
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

  return {
    name,
    startLine,
    endLine,
    code: lines.slice(startLine - 1, endLine).join("\n"),
  };
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

export function ChatPanel({
  isOpen,
  onToggle,
  context,
  onApplyCode,
  onApplyConfig,
  onApplyAndSaveCode,
  onPreviewValidatedEdit,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [modelQuery, setModelQuery] = useState("");
  const [autoContext, setAutoContext] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem("chat:autoContext");
      if (raw == null) return true;
      return raw === "true";
    } catch (e) {
      reportErrorOnce("chat:autoContext:load", "Failed to load chat auto-context preference", e, { showToast: false });
      return true;
    }
  });
  const [refinement, setRefinement] = useState<RefinementState | null>(null);
  const [preview, setPreview] = useState<null | {
    id: string;
    title: string;
    mode: ApplyMode;
    currentLabel: string;
    current: string;
    proposed: string;
    mismatchWarning: string | null;
    edits: any[] | null;
    diff: string | null;
    error: string | null;
    isValidating: boolean;
  }>(null);
  const [mentionMenuOpen, setMentionMenuOpen] = useState(false);
  const [mentionPosition, setMentionPosition] = useState<{ top: number; left: number } | undefined>();
  const [mentionQuery, setMentionQuery] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  
  // Session context that persists across messages
  const [sessionContext, setSessionContext] = useState<{
    hasContext: boolean;
    fileName?: string;
    fileContent?: string;
    backtestData?: any;
    backtestId?: number;
    config?: any;
  }>({ hasContext: false });
  
  // Fetch full backtest details when context is requested
  const fetchFullBacktestData = async (backtestId: number): Promise<any> => {
    try {
      const url = buildUrl(api.backtests.get.path, { id: backtestId });
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch backtest");
      return res.json();
    } catch (e) {
      reportErrorOnce("chat:fetchBacktest", "Failed to fetch full backtest data", e, { showToast: false });
      return null;
    }
  };
  const selectedModel = useResolvedAIModel();
  const setSelectedModel = useAIStore((s) => s.setSelectedModel);
  const modelsQuery = useAIModels();
  const models = modelsQuery.data ?? [];
  const queryClient = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);
  const refinementPollerRef = useRef<number | null>(null);
  const refinementPollInFlightRef = useRef(false);
  const refinementRef = useRef<RefinementState | null>(null);
  const announcedCompletedRef = useRef<Set<number>>(new Set());
  const hasSelection = Boolean(context.selectedCode && String(context.selectedCode).trim().length > 0);
  const sessionKey = useMemo(() => {
    // Strategy-only key for persistent chat that survives backtests and code changes
    const strategy = context.fileName ? String(context.fileName) : "global";
    return `strategy:${strategy}`;
  }, [context.fileName]);
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

  const { data: aiActions } = useQuery({
    queryKey: ["/api/ai-actions", sessionId],
    enabled: Boolean(sessionId),
    queryFn: async () => {
      const res = await fetch(`/api/ai-actions?sessionId=${sessionId}`);
      if (!res.ok) return [];
      return res.json();
    },
  });

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

  const persistMessage = async (payload: {
    role: "user" | "assistant" | "system";
    content: string;
    model?: string;
    request?: any;
    response?: any;
  }) => {
    if (!sessionId) return;
    try {
      await fetch(`/api/chat/sessions/${sessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      reportErrorOnce("/api/chat/sessions/:sessionId/messages", "Failed to persist message", e, { showToast: false });
    }
  };

  const createAiAction = async (payload: {
    actionType: string;
    description: string;
    beforeState?: any;
    afterState?: any;
    diff?: any;
    backtestId?: number;
    diagnosticReportId?: number;
    results?: any;
  }) => {
    try {
      await fetch("/api/ai-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionId ?? undefined,
          ...payload,
        }),
      });
    } catch (e) {
      reportErrorOnce("chat:ai-actions", "Failed to persist AI action", e, { showToast: false });
    }
  };

  const logCodeChange = (code: string, mode: ApplyMode) => {
    const before = (() => {
      if (mode === "selection") return context.selectedCode;
      if (mode === "enclosingFunction") return enclosingFunctionBlock?.code ?? null;
      if (mode === "namedFunction") {
        const fn = inferSingleFunctionName(code);
        const block = inferPythonFunctionBlockByNameFromFile(context.fileContent, fn);
        return block?.code ?? null;
      }
      return null;
    })();
    createAiAction({
      actionType: "code_change",
      description: `Applied AI code suggestion (${mode}).`,
      beforeState: { mode, selection: before || "" },
      afterState: { mode, code },
    });
  };

  const requestValidatedPreview = async (payload: {
    title: string;
    mode: ApplyMode;
    currentLabel: string;
    current: string;
    proposed: string;
    mismatchWarning: string | null;
    edits: any[] | null;
  }) => {
    const id = createMessageId();
    const wantsValidatedSave =
      Boolean(onPreviewValidatedEdit) &&
      Boolean(canApplyAndSave) &&
      typeof context.fileName === "string";

    const hasEdits = Array.isArray(payload.edits) && payload.edits.length > 0;
    const shouldValidate = wantsValidatedSave && hasEdits;
    const unsupportedReason = wantsValidatedSave && !hasEdits
      ? "Cannot build a validated edit for this change. Select whole lines, or apply a single function snippet so it can be replaced safely."
      : null;

    setPreview({
      id,
      title: payload.title,
      mode: payload.mode,
      currentLabel: payload.currentLabel,
      current: payload.current,
      proposed: payload.proposed,
      mismatchWarning: payload.mismatchWarning,
      edits: payload.edits,
      diff: null,
      error: unsupportedReason,
      isValidating: shouldValidate,
    });

    if (!shouldValidate) return;

    try {
      const res = await onPreviewValidatedEdit!({
        strategyPath: String(context.fileName),
        edits: payload.edits as any[],
        dryRun: true,
      });
      const diff = typeof (res as any)?.diff === "string" ? String((res as any).diff) : null;
      setPreview((prev) => (prev && prev.id === id ? { ...prev, diff, error: null, isValidating: false } : prev));
    } catch (e: any) {
      const msg = String(e?.message || e || "Validation failed");
      setPreview((prev) => (prev && prev.id === id ? { ...prev, error: msg, isValidating: false } : prev));
    }
  };

  const logConfigChange = (patch: Record<string, unknown>) => {
    createAiAction({
      actionType: "config_change",
      description: "Applied AI config patch.",
      afterState: { patch },
    });
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
          if (final && autoContext) {
            // Auto-load context when backtest completes and autoContext is enabled
            const backtestId = final.summaries[0]?.id || context.lastBacktest?.id;
            if (backtestId && Number.isFinite(backtestId)) {
              (async () => {
                const fullBacktestData = await fetchFullBacktestData(backtestId);
                if (fullBacktestData) {
                  setSessionContext({
                    hasContext: true,
                    fileName: context.fileName,
                    fileContent: context.fileContent,
                    backtestData: fullBacktestData.results,
                    backtestId: backtestId,
                    config: fullBacktestData.config,
                  });
                  pushMessage("assistant", "[Context auto-loaded: File and backtest data are now available for this session]");
                }
              })();
            }
          }
        }
      } finally {
        refinementPollInFlightRef.current = false;
      }
    };

    refinementPollerRef.current = window.setInterval(() => {
      pollOnce().catch((e) => {
        reportErrorOnce("chat:refinementPoll", "Refinement polling failed", e, { showToast: false });
      });
    }, 1500);

    pollOnce().catch((e) => {
      reportErrorOnce("chat:refinementPoll", "Refinement polling failed", e, { showToast: false });
    });
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
      createAiAction({
        actionType: "backtest_run",
        description: `Backtest started (ID ${id})`,
        backtestId: id,
        results: { strategyName, config: payload?.config },
      });
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
      createAiAction({
        actionType: "backtest_run",
        description: `Batch backtest started (${data?.batchId ?? "?"})`,
        results: { strategyName, baseConfig: payload?.baseConfig, ids, batchId: data?.batchId },
      });
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
      
      // Build enhanced context with session data if available
      const enhancedContext: any = {
        fileName: context.fileName,
        fileContent: typeof context.fileContent === "string" ? context.fileContent.slice(0, 22000) : context.fileContent,
        selectedCode: typeof context.selectedCode === "string" ? context.selectedCode.slice(0, 6000) : context.selectedCode,
        lineNumber: context.lineNumber,
        cursorFunctionName: cursorFunctionNameForRequest,
        lastBacktest: context.lastBacktest,
        backtestResults: context.backtestResults,
      };
      
      // Include full session context if @context was mentioned
      if (sessionContext.hasContext) {
        enhancedContext.sessionContext = {
          fileName: sessionContext.fileName,
          fileContent: sessionContext.fileContent?.slice(0, 30000), // Larger slice for full context
          backtestData: sessionContext.backtestData,
          backtestId: sessionContext.backtestId,
          config: sessionContext.config,
        };
      }
      
      const res = await apiRequest("POST", "/api/ai/chat", {
        message,
        model: selectedModel,
        context: enhancedContext,
      });
      return res.json();
    },
    onSuccess: (data: { response?: string } | null) => {
      const content = typeof data?.response === "string" ? data.response.trim() : "";
      if (!content) {
        setMessages((prev) => [
          ...prev,
          {
            id: createMessageId(),
            role: "assistant",
            content: "Error: AI returned an empty response.",
            timestamp: new Date(),
          },
        ]);
        return;
      }

      setMessages((prev) => [
        ...prev,
        {
          id: createMessageId(),
          role: "assistant",
          content,
          timestamp: new Date(),
        },
      ]);
      persistMessage({
        role: "assistant",
        content,
        model: selectedModel,
        response: { content },
      });
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
      queryClient.invalidateQueries({ queryKey: [api.backtests.list.path] }).catch((e) => {
        reportErrorOnce("chat:backtests:invalidate", "Failed to refresh backtests list", e, { showToast: true });
      });
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

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const loadSession = async () => {
      setHydrated(false);
      try {
        const res = await fetch(`/api/chat/sessions?sessionKey=${encodeURIComponent(sessionKey)}`);
        const data = await res.json();
        let session = Array.isArray(data) ? data[0] : null;
        if (!session) {
          const createRes = await fetch("/api/chat/sessions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionKey,
              strategyPath: context.fileName,
              backtestId: context.lastBacktest?.id,
            }),
          });
          session = await createRes.json();
        }
        if (cancelled) return;
        setSessionId(session?.id ?? null);
        if (session?.id) {
          const msgRes = await fetch(`/api/chat/sessions/${session.id}/messages?limit=50`);
          const msgs = await msgRes.json();
          if (cancelled) return;
          const mapped: Message[] = Array.isArray(msgs)
            ? msgs.map((m: any) => ({
                id: String(m.id),
                role: m.role === "assistant" ? "assistant" : "user",
                content: String(m.content || ""),
                timestamp: m.createdAt ? new Date(m.createdAt) : new Date(),
              }))
            : [];
          setMessages(mapped);
        }
      } catch (e) {
        reportErrorOnce("chat:session:load", "Failed to load chat session", e, { showToast: true });
      } finally {
        if (!cancelled) setHydrated(true);
      }
    };
    loadSession().catch((e) => {
      reportErrorOnce("chat:session:load", "Failed to load chat session", e, { showToast: true });
      setHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen, sessionKey, context.fileName, context.lastBacktest?.id]);

  const runBatchMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await apiRequest("POST", api.backtests.batchRun.path, payload);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: [api.backtests.list.path] }).catch((e) => {
        reportErrorOnce("chat:backtests:invalidate", "Failed to refresh backtests list", e, { showToast: true });
      });
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

  const runDiagnosticMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await apiRequest("POST", "/api/diagnostic/analyze", payload);
      return res.json();
    },
    onError: (error: any) => {
      setMessages((prev) => [
        ...prev,
        {
          id: createMessageId(),
          role: "assistant",
          content: `Error running diagnostic: ${error?.message || "Failed to run diagnostic"}`,
          timestamp: new Date(),
        },
      ]);
    },
  });

  useEffect(() => {
    // Reset session context when file or backtest changes
    setSessionContext({ hasContext: false });
  }, [context.fileName, context.lastBacktest?.id]);

  useEffect(() => {
    const handleAttach = (e: any) => {
      setInput(prev => prev + (prev ? "\n\n" : "") + e.detail);
    };
    window.addEventListener('attach-backtest-results', handleAttach);
    window.addEventListener('attach-diagnostic-summary', handleAttach);
    return () => {
      window.removeEventListener('attach-backtest-results', handleAttach);
      window.removeEventListener('attach-diagnostic-summary', handleAttach);
    };
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
      localStorage.setItem("chat:autoContext", String(autoContext));
    } catch (e) {
      reportErrorOnce("chat:autoContext:save", "Failed to save chat auto-context preference", e, { showToast: false });
    }
  }, [autoContext]);

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
    persistMessage({
      role: "user",
      content: input.trim(),
      model: selectedModel,
      request: {
        context: {
          fileName: context.fileName,
          lineNumber: context.lineNumber,
          lastBacktest: context.lastBacktest,
        },
      },
    });
    chatMutation.mutate(input.trim());
    setInput("");
    setMentionMenuOpen(false);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    const cursorPosition = e.target.selectionStart;
    setInput(value);

    // Detect @ mention
    const textBeforeCursor = value.slice(0, cursorPosition);
    const lastAtIndex = textBeforeCursor.lastIndexOf("@");

    if (lastAtIndex === -1) {
      setMentionMenuOpen(false);
      return;
    }

    const textAfterAt = textBeforeCursor.slice(lastAtIndex + 1);
    if (textAfterAt.includes(" ") || textAfterAt.includes("\n")) {
      setMentionMenuOpen(false);
      return;
    }

    setMentionQuery(textAfterAt.toLowerCase());
    setMentionMenuOpen(true);

    // Calculate position
    if (textareaRef.current) {
      const textarea = textareaRef.current;
      const lineHeight = 20;
      const lines = textBeforeCursor.slice(0, lastAtIndex).split("\n");
      const currentLine = lines.length;
      const charWidth = 8;
      const currentCol = lines[lines.length - 1]?.length || 0;

      setMentionPosition({
        top: -280,
        left: Math.min(currentCol * charWidth, 200),
      });
    }
  };

  const handleMentionSelect = (item: MentionItem) => {
    const cursorPosition = textareaRef.current?.selectionStart || 0;
    const textBeforeCursor = input.slice(0, cursorPosition);
    const lastAtIndex = textBeforeCursor.lastIndexOf("@");

    if (lastAtIndex !== -1) {
      const beforeAt = input.slice(0, lastAtIndex);
      const afterCursor = input.slice(cursorPosition);
      const newText = beforeAt + `@${item.id} ` + afterCursor;
      setInput(newText);

      // Execute the item's action
      item.action();
    }

    setMentionMenuOpen(false);
    textareaRef.current?.focus();
  };

  const mentionItems = useMemo(() => {
    return defaultMentionItems({
      backtestResults: context.backtestResults,
      fileName: context.fileName,
      selectedCode: context.selectedCode,
      onWebSearch: () => {
        setInput((prev) => (prev ? `${prev}\n\n@web ` : "@web "));
        textareaRef.current?.focus();
      },
      onIncludeContext: () => {
        setAutoContext(true);
        setInput((prev) => (prev ? `${prev}\n\n@context ` : "@context "));
        textareaRef.current?.focus();
        const backtestId = Number(context.lastBacktest?.id ?? NaN);
        (async () => {
          const fullBacktestData = Number.isFinite(backtestId) ? await fetchFullBacktestData(backtestId) : null;
          setSessionContext({
            hasContext: true,
            fileName: context.fileName,
            fileContent: context.fileContent,
            backtestData: fullBacktestData?.results || context.backtestResults,
            backtestId: Number.isFinite(backtestId) ? backtestId : undefined,
            config: fullBacktestData?.config || context.lastBacktest?.config,
          });
        })().catch(() => undefined);
        
        // Remove loading indicator and add confirmation
        setInput((prev) => prev.replace("[Loading context...] ", "[Context loaded - AI has access to file and backtest data] "));
      },
      onIncludeCode: () => {
        if (context.selectedCode) {
          setInput((prev) => prev + `\n\nSelected Code:\n\`\`\`python\n${context.selectedCode}\n\`\`\``);
        }
      },
      onOptimizeParams: () => {
        const prompt = [
          "Optimize my strategy parameters for better risk-adjusted returns.",
          "Prioritize lower drawdown and more stable performance over raw profit.",
          "Use my latest backtest metrics and propose a config_patch (only allowed keys).",
          "Also propose next_experiments and optionally an action to run a batch backtest.",
        ].join("\n");

        setAutoContext(true);
        setInput((prev) => {
          const base = prev && prev.trim().length ? `${prev.trim()}\n\n` : "";
          return `${base}${prompt}`;
        });
        textareaRef.current?.focus();
      },
    }).filter((item) => item.label.toLowerCase().includes(mentionQuery));
  }, [context, mentionQuery]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (mentionMenuOpen) {
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionMenuOpen(false);
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter") {
        // Let MentionMenu handle these keys
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const filteredModels = useMemo(() => {
    const q = modelQuery.trim().toLowerCase();
    const list = Array.isArray(models) ? models : [];
    if (!q) return list;
    return list.filter((m) => {
      const id = String((m as any)?.id ?? "").toLowerCase();
      const name = String((m as any)?.name ?? "").toLowerCase();
      const desc = String((m as any)?.description ?? "").toLowerCase();
      return id.includes(q) || name.includes(q) || desc.includes(q);
    });
  }, [models, modelQuery]);

  return (
    <div
      data-testid="panel-chat"
      className={cn(
        "h-full w-full border-l border-border/50 flex flex-col overflow-hidden relative",
        "bg-gradient-to-b from-background via-background to-primary/5",
        "transition-opacity duration-200",
        !isOpen && "pointer-events-none opacity-0",
      )}
    >
      <div className="absolute inset-0 pointer-events-none opacity-70 [mask-image:radial-gradient(70%_60%_at_70%_0%,black,transparent)]">
        <div className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-primary/20 blur-3xl" />
        <div className="absolute -bottom-28 -left-24 h-72 w-72 rounded-full bg-primary/10 blur-3xl" />
      </div>

      <div className={cn(
        "relative z-10 flex items-center justify-between gap-2 px-3 py-3",
        "border-b border-border/40",
        "bg-background/55 backdrop-blur",
        "shadow-[0_1px_0_0_rgba(255,255,255,0.04)]",
      )}>
        <div className="flex items-center gap-2 min-w-0">
          <div className="h-8 w-8 rounded-lg border border-border/50 bg-primary/10 flex items-center justify-center shadow-sm">
            <Bot className="w-4 h-4 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm truncate">AI Assistant</span>
              {selectedModel ? (
                <Popover open={modelPickerOpen} onOpenChange={setModelPickerOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className={cn(
                        "inline-flex items-center gap-1.5",
                        "text-[10px] px-1.5 py-0.5 rounded",
                        "border border-primary/20",
                        "bg-primary/10",
                        "text-primary/90",
                        "font-mono tracking-tight",
                        "truncate",
                        "hover:bg-primary/15 hover:border-primary/30",
                        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                      )}
                      title="Click to switch models (free only)"
                    >
                      <span className="truncate">{selectedModel}</span>
                      <ChevronDown className="w-3 h-3 opacity-70 shrink-0" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="start"
                    sideOffset={8}
                    className={cn(
                      "w-[360px] p-2",
                      "border border-border/50",
                      "bg-background/70 backdrop-blur-xl",
                      "shadow-lg",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2 px-1 pb-2">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold truncate">Free OpenRouter models</div>
                        <div className="text-[10px] text-muted-foreground truncate">Sorted by most recently updated (when available)</div>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 rounded-lg border border-border/40 bg-background/40"
                        title="Refresh list"
                        onClick={() =>
                          modelsQuery.refetch().catch((e) => {
                            reportErrorOnce("chat:models:refetch", "Failed to refresh AI models", e, { showToast: false });
                          })
                        }
                      >
                        <RefreshCw className={cn("w-3.5 h-3.5", modelsQuery.isFetching && "animate-spin")} />
                      </Button>
                    </div>

                    <div className="px-1 pb-2">
                      <Input
                        value={modelQuery}
                        onChange={(e) => setModelQuery(e.target.value)}
                        placeholder="Search models..."
                        className={cn(
                          "h-8 text-xs",
                          "rounded-xl",
                          "bg-background/50",
                          "border-border/40",
                        )}
                      />
                    </div>

                    <div className="px-1">
                      <ScrollArea className="h-[260px]">
                        <div className="space-y-1 pr-2">
                          {modelsQuery.isLoading ? (
                            <div className="text-xs text-muted-foreground px-2 py-2">Loading models...</div>
                          ) : filteredModels.length === 0 ? (
                            <div className="text-xs text-muted-foreground px-2 py-2">No matches.</div>
                          ) : (
                            filteredModels.map((m) => {
                              const id = String((m as any)?.id ?? "");
                              const name = String((m as any)?.name ?? id);
                              const description = (m as any)?.description ? String((m as any).description) : "";
                              const isSelected = id === selectedModel;
                              return (
                                <button
                                  key={id}
                                  type="button"
                                  className={cn(
                                    "w-full text-left rounded-xl px-2 py-2",
                                    "border border-border/40",
                                    "bg-background/35 backdrop-blur",
                                    "hover:bg-primary/10 hover:border-primary/25",
                                    "transition-colors",
                                    isSelected && "border-primary/30 bg-primary/10",
                                  )}
                                  onClick={() => {
                                    if (!id) return;
                                    setSelectedModel(id);
                                    setModelPickerOpen(false);
                                  }}
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                      <div className="text-xs font-semibold truncate">{name}</div>
                                      <div className="text-[10px] text-muted-foreground font-mono truncate">{id}</div>
                                    </div>
                                    <div className="shrink-0 pt-0.5">
                                      {isSelected ? <Check className="w-4 h-4 text-primary" /> : null}
                                    </div>
                                  </div>
                                  {description ? (
                                    <div className="mt-1 text-[10px] text-muted-foreground line-clamp-2">{description}</div>
                                  ) : null}
                                </button>
                              );
                            })
                          )}
                        </div>
                      </ScrollArea>
                    </div>
                  </PopoverContent>
                </Popover>
              ) : null}
            </div>
            <div className="text-[10px] text-muted-foreground truncate">
              {sessionId ? `Session #${sessionId}` : "Ready"}
              {sessionContext.hasContext && (
                <span className="ml-2 inline-flex items-center gap-1 text-primary">
                  <Database className="w-3 h-3" />
                  Context loaded
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {(context.fileName || context.backtestResults) && (
        <div className="relative z-10 px-3 py-2 border-b border-border/30 bg-background/40 backdrop-blur">
          <div className="flex flex-col gap-2">
            {context.fileName && (
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground min-w-0">
                  <FileCode className="w-3 h-3 text-primary shrink-0" />
                  <span className="truncate font-medium">{context.fileName.split("/").pop()}</span>
                  {context.lineNumber && (
                    <span className="text-[10px] bg-secondary/40 px-1.5 py-0.5 rounded-md border border-border/30 shrink-0">
                      L{context.lineNumber}
                    </span>
                  )}
                  {context.selectedCode && (
                    <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-md border border-primary/20 shrink-0">
                      {context.selectedCode.split("\n").length}L selected
                    </span>
                  )}
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "h-7 px-2.5 text-[10px] rounded-lg",
                  autoContext ? "bg-primary/10 text-primary hover:bg-primary/15" : "hover:bg-primary/10 hover:text-primary",
                )}
                title="When enabled, context (file + backtest data) is automatically loaded for all messages. When disabled, use @context to load manually."
                onClick={() => setAutoContext((v) => !v)}
              >
                <Database className="w-3 h-3" />
                Context: {autoContext ? "Auto" : "Manual"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {Array.isArray(aiActions) && aiActions.length > 0 && (
        <div className="relative z-10 px-3 py-2 border-b border-border/30 bg-background/40 backdrop-blur">
          <AIActionTimeline actions={aiActions} variant="compact" />
        </div>
      )}

      {refinement && refinement.stage !== "idle" && (
        <div className="relative z-10 px-3 py-2 border-b border-border/30 bg-background/40 backdrop-blur">
          <div className="rounded-xl border border-border/40 bg-muted/20 px-3 py-2 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-medium">
                {(refinement.stage === "running" || refinement.stage === "starting") ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : null}
                <span>
                  Refinement: {refinement.stage}
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

      <ScrollArea ref={scrollRef} className="relative z-10 flex-1 px-3 py-4">
        <div className="space-y-4">
          {!hydrated && (
            <div className="text-xs text-muted-foreground">Loading chat history...</div>
          )}

          {messages.length === 0 && (
            <div className="text-center text-muted-foreground text-sm py-8 space-y-4">
              <div className="mx-auto h-12 w-12 rounded-2xl border border-border/50 bg-primary/10 flex items-center justify-center shadow-sm">
                <MessageSquare className="w-6 h-6 text-primary/80" />
              </div>
              {context.selectedCode && (
                <div className="mt-2 p-3 bg-primary/5 border border-primary/20 rounded-xl text-[10px] text-primary max-w-[520px] mx-auto text-left">
                  <div className="flex items-center gap-1 mb-1 font-semibold uppercase">
                    <Code className="w-2.5 h-2.5" />
                    Context: Selected Snippet
                  </div>
                  <pre className="truncate opacity-70 italic">"{context.selectedCode.substring(0, 100)}..."</pre>
                </div>
              )}
            </div>
          )}

          {messages.map((message) => (
            <div
              key={message.id}
              data-testid={`message-${message.role}-${message.id}`}
              className={cn(
                "flex gap-3",
                message.role === "user" ? "justify-end" : "justify-start",
              )}
            >
              {message.role === "assistant" && (
                <div className="w-8 h-8 rounded-xl border border-border/40 bg-primary/10 flex items-center justify-center flex-shrink-0 shadow-sm">
                  <Bot className="w-4 h-4 text-primary" />
                </div>
              )}

              <div className="flex flex-col gap-2 max-w-[86%]">
                <div
                  className={cn(
                    "rounded-2xl px-3 py-2 text-sm border shadow-sm",
                    message.role === "user"
                      ? "bg-primary text-primary-foreground border-primary/30"
                      : "bg-background/60 backdrop-blur border-border/40",
                  )}
                >
                  <div className="whitespace-pre-wrap leading-relaxed">
                    {message.content.split(/(```[\s\S]*?```)/).map((part, i) => {
                      if (part.startsWith("```")) {
                        const cleaned = part.replace(/```[a-z]*\n|```/g, "");
                        return (
                          <code
                            key={i}
                            className={cn(
                              "block p-3 rounded-xl my-2 overflow-x-auto",
                              "bg-black/30 border border-border/30",
                              "text-[12px] font-mono",
                            )}
                          >
                            {cleaned}
                          </code>
                        );
                      }
                      return <span key={i}>{part}</span>;
                    })}
                  </div>
                </div>

                {message.role === "assistant" && parseChoiceBlocks(message.content).length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {parseChoiceBlocks(message.content).map((c) => (
                      <Button
                        key={c.label}
                        size="sm"
                        variant="outline"
                        className="h-8 text-[10px] gap-1.5 rounded-xl bg-background/60 backdrop-blur hover-elevate"
                        onClick={() => {
                          setInput((prev) => prev + (prev ? "\n" : "") + c.value);
                        }}
                        title={c.value}
                      >
                        {c.label}) {c.value.length > 42 ? `${c.value.slice(0, 42)}…` : c.value}
                      </Button>
                    ))}
                  </div>
                )}

                {message.role === "assistant" && (onApplyCode || onApplyConfig) && extractCodeBlocks(message.content).length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {extractCodeBlocks(message.content).map((block, idx) => {
                      const patch = onApplyConfig ? parseConfigPatch(block) : null;
                      const action = parseActionBlock(block);
                      const hasConfigPatch = patch != null && Object.keys(patch).length > 0;
                      const hasAction = action != null;
                      const allowApplyToEditor =
                        Boolean(onApplyCode) &&
                        !hasConfigPatch &&
                        !hasAction &&
                        isLikelyEditablePythonSuggestion(block);
                      const mismatchWarningRaw = shouldWarnFunctionMismatch(context.selectedCode, cursorFunctionName, block);
                      const snippetFn = inferSingleFunctionName(block.code);
                      const canReplaceEnclosing =
                        !hasSelection &&
                        Boolean(cursorFunctionName) &&
                        Boolean(snippetFn) &&
                        cursorFunctionName === snippetFn;
                      const namedTarget = snippetFn ? inferPythonFunctionBlockByNameFromFile(context.fileContent, snippetFn) : null;
                      const canReplaceByName =
                        !hasSelection &&
                        Boolean(snippetFn) &&
                        Boolean(namedTarget?.code);

                      const applyMode: ApplyMode = hasSelection
                        ? "selection"
                        : (canReplaceEnclosing ? "enclosingFunction" : (canReplaceByName ? "namedFunction" : "cursor"));
                      const mismatchWarning = applyMode === "namedFunction" ? null : mismatchWarningRaw;

                      const proposedNormalized = (() => {
                        const snippet = String(block.code || "");
                        if (applyMode === "selection") {
                          const first = String(context.selectedCode || "").split(/\r?\n/).find((l) => String(l).trim()) || "";
                          return reindentBlockTo(snippet, leadingIndentStr(first));
                        }
                        if (applyMode === "enclosingFunction") {
                          const first = String(enclosingFunctionBlock?.code || "")
                            .split(/\r?\n/)
                            .find((l) => String(l).trim()) || "";
                          return reindentBlockTo(snippet, leadingIndentStr(first));
                        }
                        if (applyMode === "namedFunction") {
                          const first = String(namedTarget?.code || "").split(/\r?\n/).find((l) => String(l).trim()) || "";
                          return reindentBlockTo(snippet, leadingIndentStr(first));
                        }
                        const firstNonEmpty = snippet.split(/\r?\n/).find((l) => String(l).trim().length > 0) || "";
                        const ind = leadingIndent(firstNonEmpty);
                        const isClassOrTopLevel = /^\s*class\s+/.test(firstNonEmpty) || /^\s*def\s+/.test(firstNonEmpty);
                        const useHeuristic = ind > 0 && isClassOrTopLevel;
                        if (useHeuristic) {
                          const methodIndent = inferStrategyMethodIndentFromFile(context.fileContent);
                          return reindentBlockTo(snippet, methodIndent);
                        }
                        return dedentBlock(snippet);
                      })();

                      const previewCurrentLabel =
                        applyMode === "selection"
                          ? "Selected"
                          : (applyMode === "enclosingFunction"
                            ? `Function '${cursorFunctionName ?? ""}'`
                            : (applyMode === "namedFunction" ? `Function '${snippetFn ?? ""}'` : "Cursor Context"));
                      const previewCurrent =
                        applyMode === "selection"
                          ? String(context.selectedCode || "")
                          : (applyMode === "enclosingFunction"
                            ? (enclosingFunctionBlock?.code ?? getCursorContextSnippet(context.fileContent, context.lineNumber))
                            : (applyMode === "namedFunction"
                              ? (namedTarget?.code ?? getCursorContextSnippet(context.fileContent, context.lineNumber))
                              : getCursorContextSnippet(context.fileContent, context.lineNumber)));
                      const previewTitle =
                        applyMode === "selection"
                          ? "Preview: Replace Selection"
                          : (applyMode === "enclosingFunction"
                            ? "Preview: Replace Current Function"
                            : (applyMode === "namedFunction" ? "Preview: Replace Function by Name" : "Preview: Insert"));

                      const previewEdits = (() => {
                        if (!canApplyAndSave) return null;
                        if (applyMode === "selection") {
                          const r = findSelectionRangeFromFile(context.fileContent, context.selectedCode);
                          if (!r) return null;
                          return [
                            {
                              kind: "replace",
                              target: { kind: "range", startLine: r.startLine, endLine: r.endLine },
                              before: r.before,
                              after: proposedNormalized,
                            },
                          ];
                        }
                        if (applyMode === "enclosingFunction" && cursorFunctionName && enclosingFunctionBlock?.code) {
                          return [
                            {
                              kind: "replace",
                              target: { kind: "function", name: cursorFunctionName },
                              before: enclosingFunctionBlock.code,
                              after: proposedNormalized,
                            },
                          ];
                        }
                        if (applyMode === "namedFunction" && snippetFn && namedTarget?.code) {
                          return [
                            {
                              kind: "replace",
                              target: { kind: "function", name: snippetFn },
                              before: namedTarget.code,
                              after: proposedNormalized,
                            },
                          ];
                        }
                        if (applyMode === "cursor") {
                          const firstNonEmpty = String(block.code || "")
                            .split(/\r?\n/)
                            .find((l) => String(l).trim().length > 0) || "";
                          const ind = leadingIndent(firstNonEmpty);
                          const isClassOrTopLevel = /^\s*class\s+/.test(firstNonEmpty) || /^\s*def\s+/.test(firstNonEmpty);
                          const useHeuristic = ind > 0 && isClassOrTopLevel;
                          return [
                            {
                              kind: "insert",
                              anchor: useHeuristic ? { kind: "heuristic_indicators" } : { kind: "module_end" },
                              content: proposedNormalized,
                            },
                          ];
                        }
                        return null;
                      })();

                      const openPreview = () => {
                        requestValidatedPreview({
                          title: previewTitle,
                          mode: applyMode,
                          currentLabel: previewCurrentLabel,
                          current: previewCurrent,
                          proposed: proposedNormalized,
                          mismatchWarning,
                          edits: previewEdits,
                        });
                      };

                      const actionButtonClass = "h-8 text-[10px] gap-1.5 rounded-xl bg-background/60 backdrop-blur hover-elevate";

                      return (
                        <div key={idx} className="flex gap-2">
                          {action && (
                            <Button
                              size="sm"
                              variant="outline"
                              className={actionButtonClass}
                              disabled={runBacktestMutation.isPending || runBatchMutation.isPending || runDiagnosticMutation.isPending}
                              onClick={() => {
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

                                if (action.action === "run_diagnostic") {
                                  const backtestId = Number(action.payload?.backtestId ?? context.lastBacktest?.id ?? NaN);
                                  if (!Number.isFinite(backtestId)) {
                                    pushMessage("assistant", "Diagnostic action is missing backtestId.");
                                    return;
                                  }

                                  const strategyPath = String(
                                    action.payload?.strategyPath || context.lastBacktest?.strategyName || context.fileName || "",
                                  ).trim();

                                  const ok = confirm(`Queue diagnostics for backtest ${backtestId}?`);
                                  if (!ok) return;

                                  runDiagnosticMutation.mutate(
                                    { backtestId, strategyPath: strategyPath || undefined },
                                    {
                                      onSuccess: (data: any) => {
                                        const jobId = String(data?.jobId || "");
                                        pushMessage(
                                          "assistant",
                                          jobId
                                            ? `Diagnostics queued. Job ID: ${jobId}. Open the Diagnostics tab to track progress.`
                                            : "Diagnostics queued. Open the Diagnostics tab to track progress.",
                                        );
                                        createAiAction({
                                          actionType: "diagnostic_run",
                                          description: jobId ? `Diagnostics queued (job ${jobId})` : "Diagnostics queued",
                                          backtestId,
                                          results: { jobId },
                                        });
                                      },
                                    },
                                  );
                                  return;
                                }

                                alert(`Unknown action: ${String((action as any).action)}`);
                              }}
                            >
                              <BarChart3 className="w-3.5 h-3.5" />
                              {typeof action.label === "string" && action.label.trim() ? action.label.trim() : "Run"}
                            </Button>
                          )}

                          {allowApplyToEditor && (
                            <Button
                              size="sm"
                              variant="outline"
                              className={actionButtonClass}
                              onClick={openPreview}
                            >
                              <Eye className="w-3.5 h-3.5" />
                              Preview
                            </Button>
                          )}

                          {allowApplyToEditor && (
                            <Button
                              size="sm"
                              variant="outline"
                              className={actionButtonClass}
                              onClick={openPreview}
                            >
                              <Code className="w-3.5 h-3.5" />
                              {hasSelection
                                ? "Replace Selection"
                                : (canReplaceEnclosing
                                  ? "Replace Current Function"
                                  : (canReplaceByName
                                    ? `Replace Function '${snippetFn}'`
                                    : "Insert"))}
                            </Button>
                          )}

                          {allowApplyToEditor && canApplyAndSave && Boolean(onApplyAndSaveCode) && (
                            <Button
                              size="sm"
                              variant="outline"
                              className={actionButtonClass}
                              onClick={openPreview}
                            >
                              <Save className="w-3.5 h-3.5" />
                              Apply & Save
                            </Button>
                          )}

                          {hasConfigPatch && (
                            <Button
                              size="sm"
                              variant="outline"
                              className={actionButtonClass}
                              onClick={() => {
                                onApplyConfig?.(patch);
                                logConfigChange(patch);
                              }}
                            >
                              <FileCode className="w-3.5 h-3.5" />
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
                <div className="w-8 h-8 rounded-xl border border-border/40 bg-secondary/60 backdrop-blur flex items-center justify-center flex-shrink-0 shadow-sm">
                  <User className="w-4 h-4" />
                </div>
              )}
            </div>
          ))}

          {chatMutation.isPending && (
            <div className="flex gap-3 justify-start animate-in fade-in slide-in-from-left-2 duration-300">
              <div className="w-8 h-8 rounded-xl border border-border/40 bg-primary/10 flex items-center justify-center flex-shrink-0 shadow-sm">
                <Bot className="w-4 h-4 text-primary" />
              </div>
              <div className="rounded-2xl px-3 py-2 text-sm border border-border/40 bg-background/60 backdrop-blur flex items-center gap-2 shadow-sm">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
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
            {preview?.error ? (
              <DialogDescription className="text-destructive">{preview.error}</DialogDescription>
            ) : preview?.mismatchWarning ? (
              <DialogDescription className="text-destructive">{preview.mismatchWarning}</DialogDescription>
            ) : preview?.isValidating ? (
              <DialogDescription>Validating change...</DialogDescription>
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

          {(preview?.diff || preview?.isValidating || preview?.error) && (
            <div className="mt-3 border border-border/40 rounded-md overflow-hidden">
              <div className="px-3 py-2 text-xs font-medium bg-muted/50 border-b border-border/40">
                Validated Diff
              </div>
              <pre className="p-3 text-xs font-mono whitespace-pre overflow-auto max-h-[35vh] bg-black/20">
                {preview?.diff || (preview?.isValidating ? "Validating..." : (preview?.error ? "Validation failed" : ""))}
              </pre>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setPreview(null)}>
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                if (!preview) return;
                onApplyCode?.(preview.proposed, preview.mode);
                logCodeChange(preview.proposed, preview.mode);
                setPreview(null);
              }}
              disabled={!onApplyCode || Boolean(preview?.isValidating)}
            >
              Apply
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                if (!preview) return;
                if (preview.mismatchWarning) {
                  const ok = confirm(preview.mismatchWarning);
                  if (!ok) return;
                }
                if (preview.isValidating || preview.error) return;

                if (
                  canApplyAndSave &&
                  onPreviewValidatedEdit &&
                  typeof context.fileName === "string" &&
                  Array.isArray(preview.edits) &&
                  preview.edits.length > 0
                ) {
                  setPreview((p) => (p ? { ...p, isValidating: true } : p));
                  try {
                    await onPreviewValidatedEdit({ strategyPath: String(context.fileName), edits: preview.edits, dryRun: false });
                    logCodeChange(preview.proposed, preview.mode);
                    setPreview(null);
                  } catch (e: any) {
                    const msg = String(e?.message || e || "Apply failed");
                    setPreview((p) => (p ? { ...p, error: msg, isValidating: false } : p));
                  }
                  return;
                }

                onApplyAndSaveCode?.(preview.proposed, preview.mode);
                logCodeChange(preview.proposed, preview.mode);
                setPreview(null);
              }}
              disabled={
                !canApplyAndSave ||
                (!onApplyAndSaveCode && !onPreviewValidatedEdit) ||
                Boolean(preview?.isValidating) ||
                Boolean(preview?.error)
              }
            >
              Apply & Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="p-3 border-t border-border/50 bg-background relative">
        {/* AI Quick Actions */}
        <div className="mb-2 flex flex-wrap gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setInput("Analyze my backtest results and suggest improvements")}
            className="text-xs h-7 px-2 border-white/10 bg-white/5 hover:bg-white/10 text-slate-300"
          >
            <BarChart3 className="w-3 h-3 mr-1.5 text-purple-400" />
            Analyze
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setInput("Optimize my strategy parameters for better risk-adjusted returns")}
            className="text-xs h-7 px-2 border-white/10 bg-white/5 hover:bg-white/10 text-slate-300"
          >
            <TrendingUp className="w-3 h-3 mr-1.5 text-emerald-400" />
            Optimize
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setInput("Explain how this strategy works and what each indicator does")}
            className="text-xs h-7 px-2 border-white/10 bg-white/5 hover:bg-white/10 text-slate-300"
          >
            <Sparkles className="w-3 h-3 mr-1.5 text-blue-400" />
            Explain
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setInput("Check for potential issues and suggest fixes")}
            className="text-xs h-7 px-2 border-white/10 bg-white/5 hover:bg-white/10 text-slate-300"
          >
            <Shield className="w-3 h-3 mr-1.5 text-amber-400" />
            Diagnose
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setInput("Add a new indicator to improve signal quality")}
            className="text-xs h-7 px-2 border-white/10 bg-white/5 hover:bg-white/10 text-slate-300"
          >
            <Target className="w-3 h-3 mr-1.5 text-cyan-400" />
            Add Indicator
          </Button>
        </div>

        <div className="flex gap-2">
          <div className="relative flex-1">
            <Textarea
              ref={textareaRef}
              data-testid="textarea-chat-input"
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder=""
              className={cn(
                "min-h-[60px] resize-none text-sm",
                "rounded-2xl border-border/40 bg-background/60 backdrop-blur shadow-sm",
                "focus-visible:ring-primary/30",
              )}
            />
            <MentionMenu
              isOpen={mentionMenuOpen && mentionItems.length > 0}
              onClose={() => setMentionMenuOpen(false)}
              items={mentionItems}
              onSelect={handleMentionSelect}
              position={mentionPosition}
            />
          </div>
          <Button
            data-testid="button-send-message"
            size="icon"
            onClick={handleSend}
            disabled={!input.trim() || chatMutation.isPending}
            className={cn(
              "h-[60px] w-12 flex-shrink-0 rounded-2xl",
              "bg-primary text-primary-foreground",
              "shadow-sm hover:shadow-md",
              "disabled:opacity-60",
            )}
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
