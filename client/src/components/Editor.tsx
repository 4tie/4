import MonacoEditor, { type Monaco } from "@monaco-editor/react";
import { Loader2, Save, Check, RotateCcw, MessageSquare } from "lucide-react";
import { useRef, useEffect, useCallback, useState, useImperativeHandle, forwardRef } from "react";
import type { editor, IRange } from "monaco-editor";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

import { Badge } from "@/components/ui/badge";

export interface EditorState {
  selectedCode: string;
  lineNumber: number;
  columnNumber: number;
}

export interface CodeEditorHandle {
  applyCode: (code: string) => void;
  getValue: () => string;
  replaceEnclosingFunction: (code: string) => boolean;
  replaceFunctionByName: (fnName: string, code: string) => boolean;
}

interface CodeEditorProps {
  language: "python" | "json" | "plaintext";
  value: string;
  onChange?: (value: string | undefined) => void;
  onSave?: (value: string) => Promise<void>;
  onEditorStateChange?: (state: EditorState) => void;
  readOnly?: boolean;
  onToggleChat?: () => void;
  isChatOpen?: boolean;
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
}

const leadingIndent = (line: string) => {
  const m = String(line || "").match(/^\s*/);
  return m?.[0]?.length ?? 0;
};

const isPythonDefLine = (line: string) => /^\s*def\s+[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(String(line || ""));
const isPythonDecoratorLine = (line: string) => /^\s*@/.test(String(line || ""));
const isPythonClassLine = (line: string) => /^\s*class\s+[A-Za-z_][A-Za-z0-9_]*\s*[(:]/.test(String(line || ""));

const isPythonDefForName = (line: string, fnName: string) => {
  const name = String(fnName || "").trim();
  if (!name) return false;
  const re = new RegExp(`^\\s*def\\s+${name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\s*\\(`);
  return re.test(String(line || ""));
};

const findEnclosingPythonFunctionRange = (model: editor.ITextModel, lineNumber: number): IRange | null => {
  const total = model.getLineCount();
  const target = Math.min(Math.max(1, lineNumber || 1), total);

  let searchFrom = target;
  while (searchFrom >= 1) {
    let defLine = -1;
    for (let i = searchFrom; i >= 1; i--) {
      const line = model.getLineContent(i);
      if (isPythonDefLine(line)) {
        defLine = i;
        break;
      }
    }
    if (defLine === -1) return null;

    const defIndent = leadingIndent(model.getLineContent(defLine));
    let startLine = defLine;
    while (startLine > 1) {
      const prev = model.getLineContent(startLine - 1);
      if (!isPythonDecoratorLine(prev)) break;
      if (leadingIndent(prev) !== defIndent) break;
      startLine--;
    }

    let endLine = total;
    for (let i = defLine + 1; i <= total; i++) {
      const line = model.getLineContent(i);
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
      return {
        startLineNumber: startLine,
        startColumn: 1,
        endLineNumber: Math.max(startLine, endLine),
        endColumn: model.getLineMaxColumn(Math.max(startLine, endLine)),
      };
    }

    searchFrom = defLine - 1;
  }

  return null;
};

const findPythonFunctionRangeByName = (model: editor.ITextModel, fnName: string): IRange | null => {
  const total = model.getLineCount();
  const name = String(fnName || "").trim();
  if (!name) return null;

  let defLine = -1;
  for (let i = 1; i <= total; i++) {
    const line = model.getLineContent(i);
    if (isPythonDefForName(line, name)) {
      defLine = i;
      break;
    }
  }
  if (defLine === -1) return null;

  const defIndent = leadingIndent(model.getLineContent(defLine));
  let startLine = defLine;
  while (startLine > 1) {
    const prev = model.getLineContent(startLine - 1);
    if (!isPythonDecoratorLine(prev)) break;
    if (leadingIndent(prev) !== defIndent) break;
    startLine--;
  }

  let endLine = total;
  for (let i = defLine + 1; i <= total; i++) {
    const line = model.getLineContent(i);
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
    startLineNumber: startLine,
    startColumn: 1,
    endLineNumber: Math.max(startLine, endLine),
    endColumn: model.getLineMaxColumn(Math.max(startLine, endLine)),
  };
};

export const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(({ language, value, onChange, onSave, onEditorStateChange, readOnly = false, onToggleChat, isChatOpen, quickParams }, ref) => {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  const zonesRef = useRef<{ ids: string[] }>({ ids: [] });
  const widgetsRef = useRef<{ ids: string[]; widgets: editor.IContentWidget[] }>({ ids: [], widgets: [] });
  const widgetSeqRef = useRef(0);
  const modelSubRef = useRef<{ dispose: () => void } | null>(null);
  const quickApplyModeRef = useRef<{ timeframe: "backtest" | "strategy" | "both" }>(
    { timeframe: "both" },
  );
  const lastQuickParamsRef = useRef<CodeEditorProps["quickParams"] | undefined>(undefined);

  useEffect(() => {
    setIsDirty(false);
  }, [value]);

  const handleEditorChange = (val: string | undefined) => {
    setIsDirty(val !== value);
    onChange?.(val);
  };

  const replacePythonAssignmentValue = useCallback((model: editor.ITextModel, key: string, nextValueLiteral: string) => {
    const total = model.getLineCount();
    const re = new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\s*=\\s*(.+?)\\s*$`);
    for (let i = 1; i <= total; i++) {
      const line = model.getLineContent(i);
      const m = line.match(re);
      if (!m) continue;

      const eqIdx = line.indexOf("=");
      if (eqIdx < 0) continue;

      const startColumn = eqIdx + 2;
      const endColumn = model.getLineMaxColumn(i);
      model.pushEditOperations(
        [],
        [
          {
            range: {
              startLineNumber: i,
              startColumn,
              endLineNumber: i,
              endColumn,
            },
            text: nextValueLiteral,
          },
        ],
        () => null,
      );
      return true;
    }
    return false;
  }, []);

  const replacePythonAssignmentBlockValue = useCallback(
    (model: editor.ITextModel, key: string, nextValueLiteral: string) => {
      const total = model.getLineCount();
      const lineRe = new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\s*=`);
      for (let i = 1; i <= total; i++) {
        const line = model.getLineContent(i);
        if (!lineRe.test(line)) continue;

        const eqIdx = line.indexOf("=");
        if (eqIdx < 0) continue;

        // Start scanning for a brace-balanced dict/list block beginning after '='.
        let depth = 0;
        let started = false;
        let endLine = i;
        let endColumn = model.getLineMaxColumn(i);

        for (let ln = i; ln <= total; ln++) {
          const txt = model.getLineContent(ln);
          const startAt = ln === i ? eqIdx + 1 : 0;
          for (let ci = startAt; ci < txt.length; ci++) {
            const ch = txt[ci];
            if (ch === "{") {
              depth++;
              started = true;
            } else if (ch === "}") {
              depth--;
              started = true;
              if (started && depth === 0) {
                endLine = ln;
                endColumn = ci + 2; // monaco columns are 1-based, +1 for column, +1 to include char
                ln = total + 1;
                break;
              }
            }
          }
          if (started && depth === 0) break;
        }

        const startColumn = eqIdx + 2;
        model.pushEditOperations(
          [],
          [
            {
              range: {
                startLineNumber: i,
                startColumn,
                endLineNumber: endLine,
                endColumn,
              },
              text: nextValueLiteral,
            },
          ],
          () => null,
        );
        return true;
      }
      return false;
    },
    [],
  );

  const insertPythonAssignmentInClass = useCallback((model: editor.ITextModel, key: string, valueLiteral: string) => {
    const total = model.getLineCount();
    const classRe = /^\s*class\s+[A-Za-z_][A-Za-z0-9_]*\s*\(.*\)\s*:/;
    for (let i = 1; i <= total; i++) {
      const line = model.getLineContent(i);
      if (!classRe.test(line)) continue;

      const classIndent = leadingIndent(line);
      const insertLine = Math.min(total + 1, i + 1);
      const indent = " ".repeat(classIndent + 4);
      const text = `${indent}${key} = ${valueLiteral}\n`;

      model.pushEditOperations(
        [],
        [
          {
            range: {
              startLineNumber: insertLine,
              startColumn: 1,
              endLineNumber: insertLine,
              endColumn: 1,
            },
            text,
          },
        ],
        () => null,
      );
      return true;
    }
    return false;
  }, []);

  const buildQuickParamZones = useCallback((qp?: CodeEditorProps["quickParams"]) => {
    const ed = editorRef.current;
    const model = ed?.getModel();
    const monaco = monacoRef.current;
    if (!ed || !model || !monaco) return;

    if (language !== "python") return;

    if (!qp?.enabled) return;

    const viewZoneAccessorCleanup = () => {
      if (!zonesRef.current.ids.length) return;
      ed.changeViewZones((accessor) => {
        for (const id of zonesRef.current.ids) {
          try {
            accessor.removeZone(id);
          } catch {
            // ignore
          }
        }
      });
      zonesRef.current.ids = [];
    };

    const contentWidgetCleanup = () => {
      if (!widgetsRef.current.widgets.length) return;
      for (const w of widgetsRef.current.widgets) {
        try {
          ed.removeContentWidget(w);
        } catch {
          // ignore
        }
      }
      widgetsRef.current.widgets = [];
      widgetsRef.current.ids = [];
    };

    viewZoneAccessorCleanup();
    contentWidgetCleanup();

    const total = model.getLineCount();
    const zones: string[] = [];

    const stopMonaco = (e: Event) => {
      e.stopPropagation();
    };

    const normalizeMinimalRoiLiteral = (raw: string): { ok: true; normalized: string } | { ok: false; error: string } => {
      const s = String(raw || "").trim();
      if (!s) return { ok: false, error: "Value is empty" };
      if (!s.startsWith("{") || !s.endsWith("}")) return { ok: false, error: "Must start with '{' and end with '}'" };

      let depth = 0;
      for (const ch of s) {
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
        if (depth < 0) return { ok: false, error: "Unbalanced braces" };
      }
      if (depth !== 0) return { ok: false, error: "Unbalanced braces" };

      const inner = s.slice(1, -1);
      const pairs: Array<{ k: string; v: string }> = [];
      const pairRe = /"(\d+)"\s*:\s*(-?\d+(?:\.\d+)?)/g;
      let m: RegExpExecArray | null;
      while ((m = pairRe.exec(inner)) !== null) {
        pairs.push({ k: m[1], v: m[2] });
      }

      const leftover = inner
        .replace(pairRe, "")
        .replace(/[\s,]/g, "")
        .trim();

      // leftover may contain only comments-like fragments? We don't support comments inside the literal.
      if (leftover) {
        return { ok: false, error: "Entries must look like: \"0\": 0.10" };
      }

      if (pairs.length === 0) {
        if (!inner.trim()) return { ok: true, normalized: "{}" };
        return { ok: false, error: "No valid ROI entries found" };
      }

      const normalized = `{ ${pairs.map((p) => `\"${p.k}\": ${p.v}`).join(", ")} }`;
      return { ok: true, normalized };
    };

    const extractMinimalRoiLiteral = (startLine: number): string | null => {
      const raw = model.getLineContent(startLine);
      const eqIdx = raw.indexOf("=");
      if (eqIdx < 0) return null;
      const afterEq = raw.slice(eqIdx + 1);
      const startBraceIdx = afterEq.indexOf("{");
      if (startBraceIdx < 0) return afterEq.trim();

      let depth = 0;
      let started = false;
      const chunks: string[] = [];
      for (let ln = startLine; ln <= total; ln++) {
        const txt = model.getLineContent(ln);
        const scanFrom = ln === startLine ? eqIdx + 1 : 0;
        const part = txt.slice(scanFrom);
        chunks.push(part);
        for (const ch of part) {
          if (ch === "{") {
            depth++;
            started = true;
          } else if (ch === "}") {
            depth--;
            started = true;
            if (started && depth === 0) {
              return chunks.join("\n").trim();
            }
          }
        }
      }
      return chunks.join("\n").trim();
    };

    const mkRow = () => {
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.alignItems = "center";
      row.style.flexWrap = "wrap";
      row.style.gap = "8px";
      row.style.rowGap = "6px";
      row.style.padding = "6px 8px";
      row.style.marginTop = "2px";
      row.style.boxSizing = "border-box";
      row.style.width = "100%";
      row.style.maxWidth = "calc(100% - 12px)";
      row.style.minHeight = "56px";
      row.style.pointerEvents = "auto";
      row.style.border = "1px solid rgba(168,85,247,0.22)";
      row.style.borderRadius = "10px";
      row.style.background = "rgba(10,10,15,0.65)";
      row.style.backdropFilter = "blur(6px)";
      row.style.fontSize = "11px";
      row.style.color = "#e2e8f0";

      // Prevent Monaco from treating interactions as editor selection.
      row.addEventListener("mousedown", stopMonaco);
      row.addEventListener("click", stopMonaco);
      row.addEventListener("dblclick", stopMonaco);
      row.addEventListener("wheel", stopMonaco);
      return row;
    };

    const mkLabel = (text: string) => {
      const el = document.createElement("div");
      el.textContent = text;
      el.style.fontSize = "10px";
      el.style.textTransform = "uppercase";
      el.style.letterSpacing = "0.12em";
      el.style.color = "#c4b5fd";
      return el;
    };

    const mkSelect = (opts: string[], val: string) => {
      const sel = document.createElement("select");
      sel.style.height = "24px";
      sel.style.padding = "0 6px";
      sel.style.minWidth = "90px";
      sel.style.borderRadius = "8px";
      sel.style.border = "1px solid rgba(255,255,255,0.12)";
      sel.style.background = "rgba(0,0,0,0.45)";
      sel.style.color = "#e2e8f0";
      sel.style.fontSize = "11px";
      sel.style.pointerEvents = "auto";
      sel.addEventListener("mousedown", stopMonaco);
      sel.addEventListener("click", stopMonaco);
      for (const o of opts) {
        const opt = document.createElement("option");
        opt.value = o;
        opt.textContent = o;
        sel.appendChild(opt);
      }
      sel.value = val;
      return sel;
    };

    const mkInput = (val: string) => {
      const inp = document.createElement("input");
      inp.type = "number";
      inp.step = "0.001";
      inp.style.height = "24px";
      inp.style.width = "90px";
      inp.style.padding = "0 6px";
      inp.style.minWidth = "90px";
      inp.style.borderRadius = "8px";
      inp.style.border = "1px solid rgba(255,255,255,0.12)";
      inp.style.background = "rgba(0,0,0,0.45)";
      inp.style.color = "#e2e8f0";
      inp.style.fontSize = "11px";
      inp.style.pointerEvents = "auto";
      inp.addEventListener("mousedown", stopMonaco);
      inp.addEventListener("click", stopMonaco);
      inp.value = val;
      return inp;
    };

    const mkTextInput = (val: string) => {
      const inp = document.createElement("input");
      inp.type = "text";
      inp.style.height = "24px";
      inp.style.width = "160px";
      inp.style.padding = "0 6px";
      inp.style.minWidth = "160px";
      inp.style.borderRadius = "8px";
      inp.style.border = "1px solid rgba(255,255,255,0.12)";
      inp.style.background = "rgba(0,0,0,0.45)";
      inp.style.color = "#e2e8f0";
      inp.style.fontSize = "11px";
      inp.style.pointerEvents = "auto";
      inp.addEventListener("mousedown", stopMonaco);
      inp.addEventListener("click", stopMonaco);
      inp.value = val;
      return inp;
    };

    const mkTextarea = (val: string) => {
      const ta = document.createElement("textarea");
      ta.style.height = "72px";
      ta.style.width = "340px";
      ta.style.padding = "6px";
      ta.style.minWidth = "220px";
      ta.style.borderRadius = "8px";
      ta.style.border = "1px solid rgba(255,255,255,0.12)";
      ta.style.background = "rgba(0,0,0,0.45)";
      ta.style.color = "#e2e8f0";
      ta.style.fontSize = "11px";
      ta.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
      ta.style.lineHeight = "1.35";
      ta.style.resize = "vertical";
      ta.style.pointerEvents = "auto";
      ta.addEventListener("mousedown", stopMonaco);
      ta.addEventListener("click", stopMonaco);
      ta.addEventListener("wheel", stopMonaco);
      ta.value = val;
      return ta;
    };

    const mkButton = (text: string) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = text;
      btn.style.height = "24px";
      btn.style.padding = "0 8px";
      btn.style.whiteSpace = "nowrap";
      btn.style.borderRadius = "8px";
      btn.style.border = "1px solid rgba(168,85,247,0.40)";
      btn.style.background = "rgba(168,85,247,0.14)";
      btn.style.color = "#ddd6fe";
      btn.style.fontSize = "11px";
      btn.style.cursor = "pointer";
      btn.style.pointerEvents = "auto";
      btn.addEventListener("mousedown", stopMonaco);
      btn.addEventListener("click", stopMonaco);
      return btn;
    };

    const addWidgetBelow = (afterLineNumber: number, dom: HTMLElement) => {
      const spacer = document.createElement("div");
      spacer.style.pointerEvents = "none";
      spacer.style.width = "100%";

      ed.changeViewZones((accessor) => {
        const zoneId = accessor.addZone({
          afterLineNumber,
          // Reserve enough vertical space so the content widget won't overlap the next code line.
          heightInPx: 108,
          domNode: spacer,
        });
        zones.push(zoneId);
      });

      // Make sure widget itself doesn't overflow horizontally.
      dom.style.boxSizing = "border-box";
      dom.style.maxWidth = "100%";
      dom.style.pointerEvents = "auto";

      // Align widget with editor content (not the gutter / line numbers)
      try {
        const layout = ed.getLayoutInfo();
        dom.style.marginLeft = `${layout.contentLeft}px`;
        dom.style.width = `${layout.contentWidth}px`;
      } catch {
        // ignore
      }

      const id = `quick-param-${widgetSeqRef.current++}`;
      const widget: editor.IContentWidget = {
        getId: () => id,
        getDomNode: () => dom,
        getPosition: () => ({
          // Use BELOW preference relative to the anchor line, so it lands in the view-zone spacer.
          position: { lineNumber: afterLineNumber, column: 1 },
          preference: [monaco.editor.ContentWidgetPositionPreference.BELOW],
        }),
      };

      widgetsRef.current.ids.push(id);
      widgetsRef.current.widgets.push(widget);
      ed.addContentWidget(widget);
      try {
        ed.layoutContentWidget(widget);
      } catch {
        // ignore
      }
    };

    const findAssignLine = (key: string) => {
      const re = new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\s*=`);
      for (let i = 1; i <= total; i++) {
        if (re.test(model.getLineContent(i))) return i;
      }
      return null;
    };

    const findClassLine = () => {
      const classRe = /^\s*class\s+[A-Za-z_][A-Za-z0-9_]*\s*\(.*\)\s*:/;
      for (let i = 1; i <= total; i++) {
        if (classRe.test(model.getLineContent(i))) return i;
      }
      return null;
    };

    const classLine = findClassLine();

    // Backtest-only controls (anchor under class line)
    if (classLine != null && (qp.timerange || qp.stake || qp.maxOpenTrades)) {
      const row = mkRow();
      row.appendChild(mkLabel("Backtest Config"));

      if (qp.timerange) {
        const tr = mkTextInput(qp.timerange.value);
        tr.placeholder = "YYYYMMDD-YYYYMMDD";
        const btn = mkButton("Set range");
        btn.addEventListener("click", () => {
          const v = String(tr.value || "").trim();
          if (!v) return;
          qp.timerange?.onChangeBacktest?.(v);
        });
        row.appendChild(tr);
        row.appendChild(btn);
      }

      if (qp.stake) {
        const st = mkInput(String(qp.stake.value ?? 0));
        st.step = "0.01";
        st.style.width = "110px";
        const btn = mkButton("Set stake");
        btn.addEventListener("click", () => {
          const n = Number(st.value);
          if (!Number.isFinite(n) || n <= 0) return;
          qp.stake?.onChangeBacktest?.(n);
        });
        row.appendChild(st);
        row.appendChild(btn);
      }

      if (qp.maxOpenTrades) {
        const mot = mkInput(String(qp.maxOpenTrades.value ?? 1));
        mot.step = "1";
        mot.style.width = "90px";
        const btn = mkButton("Set max");
        btn.addEventListener("click", () => {
          const n = Number(mot.value);
          if (!Number.isFinite(n) || n < 0) return;
          qp.maxOpenTrades?.onChangeBacktest?.(Math.floor(n));
        });
        row.appendChild(mot);
        row.appendChild(btn);
      }

      addWidgetBelow(classLine, row);
    }

    if (qp.timeframe) {
      const ln = findAssignLine("timeframe") ?? findClassLine();
      if (ln != null) {
        const row = mkRow();
        row.appendChild(mkLabel("Timeframe"));

        const applyTo = mkSelect(["backtest", "strategy", "both"], quickApplyModeRef.current.timeframe);
        applyTo.addEventListener("change", () => {
          const v = String(applyTo.value || "both") as any;
          quickApplyModeRef.current.timeframe = v;
        });

        const tfSel = mkSelect(qp.timeframe.options, qp.timeframe.value);
        tfSel.addEventListener("change", () => {
          const tf = String(tfSel.value || "").trim();
          const mode = quickApplyModeRef.current.timeframe;
          if (!tf) return;
          if (mode === "backtest" || mode === "both") {
            qp.timeframe?.onChangeBacktest?.(tf);
          }
          if (mode === "strategy" || mode === "both") {
            const ok = replacePythonAssignmentValue(model, "timeframe", JSON.stringify(tf));
            if (!ok) {
              insertPythonAssignmentInClass(model, "timeframe", JSON.stringify(tf));
            }
          }
        });

        row.appendChild(applyTo);
        row.appendChild(tfSel);
        addWidgetBelow(ln, row);
      }
    }

    {
      const ln = findAssignLine("stoploss");
      if (ln != null) {
        const row = mkRow();
        row.appendChild(mkLabel("Stoploss"));
        const raw = model.getLineContent(ln);
        const m = raw.match(/^\s*stoploss\s*=\s*([-0-9.]+)/);
        const current = m?.[1] ?? "";
        const inp = mkInput(current);
        const btn = mkButton("Apply");
        btn.addEventListener("click", () => {
          const v = String(inp.value || "").trim();
          if (!v) return;
          replacePythonAssignmentValue(model, "stoploss", v);
        });
        row.appendChild(inp);
        row.appendChild(btn);
        addWidgetBelow(ln, row);
      }
    }

    {
      const ln = findAssignLine("trailing_stop");
      if (ln != null) {
        const row = mkRow();
        row.appendChild(mkLabel("Trailing"));
        const raw = model.getLineContent(ln);
        const m = raw.match(/^\s*trailing_stop\s*=\s*(True|False)/);
        const current = m?.[1] ?? "False";
        const sel = mkSelect(["False", "True"], current);
        sel.addEventListener("change", () => {
          const v = String(sel.value || "False");
          replacePythonAssignmentValue(model, "trailing_stop", v);
        });
        row.appendChild(sel);
        addWidgetBelow(ln, row);
      }
    }

    {
      const ln = findAssignLine("trailing_stop_positive");
      if (ln != null) {
        const row = mkRow();
        row.appendChild(mkLabel("Trail +"));

        const raw = model.getLineContent(ln);
        const m = raw.match(/^\s*trailing_stop_positive\s*=\s*([^#]+?)\s*(#.*)?$/);
        const current = String(m?.[1] ?? "None").trim();
        const inp = mkInput(current === "None" ? "" : current);
        inp.step = "0.001";
        inp.style.width = "110px";
        inp.placeholder = "None";

        const btn = mkButton("Apply");
        btn.addEventListener("click", () => {
          const v = String(inp.value || "").trim();
          replacePythonAssignmentValue(model, "trailing_stop_positive", v ? v : "None");
        });

        row.appendChild(inp);
        row.appendChild(btn);
        addWidgetBelow(ln, row);
      }
    }

    {
      const ln = findAssignLine("trailing_stop_positive_offset");
      if (ln != null) {
        const row = mkRow();
        row.appendChild(mkLabel("Trail offset"));

        const raw = model.getLineContent(ln);
        const m = raw.match(/^\s*trailing_stop_positive_offset\s*=\s*([^#]+?)\s*(#.*)?$/);
        const current = String(m?.[1] ?? "None").trim();
        const inp = mkInput(current === "None" ? "" : current);
        inp.step = "0.001";
        inp.style.width = "110px";
        inp.placeholder = "None";

        const btn = mkButton("Apply");
        btn.addEventListener("click", () => {
          const v = String(inp.value || "").trim();
          replacePythonAssignmentValue(model, "trailing_stop_positive_offset", v ? v : "None");
        });

        row.appendChild(inp);
        row.appendChild(btn);
        addWidgetBelow(ln, row);
      }
    }

    {
      const ln = findAssignLine("trailing_only_offset_is_reached");
      if (ln != null) {
        const row = mkRow();
        row.appendChild(mkLabel("Trail only after"));

        const raw = model.getLineContent(ln);
        const m = raw.match(/^\s*trailing_only_offset_is_reached\s*=\s*(True|False)/);
        const current = m?.[1] ?? "False";
        const sel = mkSelect(["False", "True"], current);
        sel.addEventListener("change", () => {
          const v = String(sel.value || "False");
          replacePythonAssignmentValue(model, "trailing_only_offset_is_reached", v);
        });

        row.appendChild(sel);
        addWidgetBelow(ln, row);
      }
    }

    {
      const ln = findAssignLine("minimal_roi");
      if (ln != null) {
        const row = mkRow();
        row.appendChild(mkLabel("Minimal ROI"));

        const extracted = extractMinimalRoiLiteral(ln) ?? "{}";
        const normAttempt = normalizeMinimalRoiLiteral(extracted);
        const current = normAttempt.ok ? normAttempt.normalized : extracted;
        const inp = mkTextarea(current);

        const btn = mkButton("Apply");
        btn.addEventListener("click", () => {
          const v = String(inp.value || "").trim();
          if (!v) return;
          const norm = normalizeMinimalRoiLiteral(v);
          if (!norm.ok) {
            toast({
              title: "Invalid minimal_roi",
              description: norm.error,
              variant: "destructive",
            });
            return;
          }
          // Replace full dict block if multi-line.
          const ok = replacePythonAssignmentBlockValue(model, "minimal_roi", norm.normalized);
          if (!ok) {
            replacePythonAssignmentValue(model, "minimal_roi", norm.normalized);
          }
        });

        row.appendChild(inp);
        row.appendChild(btn);
        addWidgetBelow(ln, row);
      }
    }

    zonesRef.current.ids = zones;
  }, [insertPythonAssignmentInClass, language, replacePythonAssignmentValue]);

  useEffect(() => {
    return () => {
      modelSubRef.current?.dispose?.();
      modelSubRef.current = null;
      const ed = editorRef.current;
      if (ed && zonesRef.current.ids.length) {
        ed.changeViewZones((accessor) => {
          for (const id of zonesRef.current.ids) {
            try {
              accessor.removeZone(id);
            } catch {
              // ignore
            }
          }
        });
      }
      if (ed && widgetsRef.current.widgets.length) {
        for (const w of widgetsRef.current.widgets) {
          try {
            ed.removeContentWidget(w);
          } catch {
            // ignore
          }
        }
      }
      zonesRef.current.ids = [];
      widgetsRef.current.widgets = [];
      widgetsRef.current.ids = [];
    };
  }, []);

  useEffect(() => {
    const ed = editorRef.current;
    if (!ed) return;
    if (lastQuickParamsRef.current === quickParams) return;
    lastQuickParamsRef.current = quickParams;
    if (quickParams?.enabled) {
      buildQuickParamZones(quickParams);
    } else {
      if (zonesRef.current.ids.length) {
        ed.changeViewZones((accessor) => {
          for (const id of zonesRef.current.ids) {
            try {
              accessor.removeZone(id);
            } catch {
              // ignore
            }
          }
        });
      }
      zonesRef.current.ids = [];
      if (widgetsRef.current.widgets.length) {
        for (const w of widgetsRef.current.widgets) {
          try {
            ed.removeContentWidget(w);
          } catch {
            // ignore
          }
        }
      }
      widgetsRef.current.widgets = [];
      widgetsRef.current.ids = [];
    }
  }, [buildQuickParamZones, quickParams]);

  const handleSave = async () => {
    if (!editorRef.current || !onSave || !isDirty) return;
    
    setIsSaving(true);
    try {
      const currentContent = editorRef.current.getValue();
      await onSave(currentContent);
      setIsDirty(false);
      toast({
        title: "Success",
        description: "File saved successfully",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to save file",
        variant: "destructive",
      });
    } finally {
      setIsSaving(true); // Temporary visual for "Thinking" or processing if needed, but the prompt asked for system message save confirmations which useToast handles
      setTimeout(() => setIsSaving(false), 1000);
    }
  };

  const applyCode = (code: string) => {
    if (!editorRef.current) return;
    const selection = editorRef.current.getSelection();
    if (selection) {
      editorRef.current.executeEdits("ai-suggestion", [{
        range: selection,
        text: code,
        forceMoveMarkers: true
      }]);
      setIsDirty(true);
      toast({
        title: "AI Suggestion Applied",
        description: "Code has been inserted into the editor.",
      });
    } else {
      // If no selection, insert at cursor position
      const position = editorRef.current.getPosition();
      if (position) {
        editorRef.current.executeEdits("ai-suggestion", [{
          range: {
            startLineNumber: position.lineNumber,
            startColumn: position.column,
            endLineNumber: position.lineNumber,
            endColumn: position.column
          },
          text: code,
          forceMoveMarkers: true
        }]);
        setIsDirty(true);
        toast({
          title: "AI Suggestion Applied",
          description: "Code has been inserted at cursor position.",
        });
      }
    }
  };

  const replaceEnclosingFunction = (code: string): boolean => {
    if (!editorRef.current) return false;
    const model = editorRef.current.getModel();
    if (!model) return false;
    const pos = editorRef.current.getPosition();
    if (!pos) return false;

    const range = findEnclosingPythonFunctionRange(model, pos.lineNumber);
    if (!range) return false;

    editorRef.current.executeEdits("ai-suggestion", [
      {
        range,
        text: code,
        forceMoveMarkers: true,
      },
    ]);
    setIsDirty(true);
    toast({
      title: "AI Suggestion Applied",
      description: "Function was replaced at the current cursor position.",
    });
    return true;
  };

  useImperativeHandle(ref, () => ({
    applyCode,
    getValue: () => editorRef.current?.getValue() ?? value,
    replaceEnclosingFunction,
    replaceFunctionByName: (fnName: string, code: string): boolean => {
      if (!editorRef.current) return false;
      const model = editorRef.current.getModel();
      if (!model) return false;

      const range = findPythonFunctionRangeByName(model, fnName);
      if (!range) return false;

      editorRef.current.executeEdits("ai-suggestion", [
        {
          range,
          text: code,
          forceMoveMarkers: true,
        },
      ]);
      setIsDirty(true);
      toast({
        title: "AI Suggestion Applied",
        description: `Replaced function '${fnName}'.`,
      });
      return true;
    },
  }));

  const handleEditorMount = useCallback((editor: editor.IStandaloneCodeEditor, monaco: Monaco) => {
    editorRef.current = editor;

    // Define custom theme for cyan line highlighting
    monaco.editor.defineTheme('custom-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editor.lineHighlightBackground': '#00ffff10',
        'editor.lineHighlightBorder': '#00ffff30',
      }
    });

    monaco.editor.setTheme('custom-dark');

    editor.onDidChangeCursorPosition((e) => {
      const selection = editor.getSelection();
      let selectedCode = "";
      
      if (selection && !selection.isEmpty()) {
        selectedCode = editor.getModel()?.getValueInRange(selection) || "";
      }

      onEditorStateChange?.({
        selectedCode,
        lineNumber: e.position.lineNumber,
        columnNumber: e.position.column,
      });
    });

    // Add save keyboard shortcut
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      handleSave();
    });

    // Add apply suggestion command
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyI, () => {
      onToggleChat?.();
    });

    editor.onDidChangeCursorSelection((e) => {
      const selection = e.selection;
      let selectedCode = "";
      
      if (selection && !selection.isEmpty()) {
        selectedCode = editor.getModel()?.getValueInRange(selection) || "";
      }

      const position = editor.getPosition();
      onEditorStateChange?.({
        selectedCode,
        lineNumber: position?.lineNumber || 1,
        columnNumber: position?.column || 1,
      });
    });

  }, [onEditorStateChange, handleSave, onToggleChat]);

  const handleEditorDidMount = (
    ed: editor.IStandaloneCodeEditor,
    monaco: Monaco,
    qp?: CodeEditorProps["quickParams"],
  ) => {
    editorRef.current = ed;
    monacoRef.current = monaco;

    // Ensure theme exists (Editor uses theme="custom-dark")
    monaco.editor.defineTheme("custom-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [],
      colors: {
        "editor.background": "#0b0714",
        "editorGutter.background": "#0b0714",
        "editorLineNumber.foreground": "#475569",
        "editorLineNumber.activeForeground": "#c4b5fd",
        "editor.lineHighlightBackground": "#a855f71a",
        "editor.lineHighlightBorder": "#a855f733",
        "editor.selectionBackground": "#7c3aed33",
        "editor.inactiveSelectionBackground": "#7c3aed22",
      },
    });
    monaco.editor.setTheme("custom-dark");

    if (qp?.enabled) buildQuickParamZones(qp);

    const model = ed.getModel();
    modelSubRef.current?.dispose?.();
    modelSubRef.current = null;
    if (model) {
      const sub = model.onDidChangeContent(() => {
        if (qp?.enabled) buildQuickParamZones(qp);
      });
      modelSubRef.current = sub;
    }
  };

  return (
    <div className="flex flex-col h-full w-full overflow-hidden rounded-md border border-border/50 shadow-inner bg-[#1e1e1e]">
      <div className="flex-1 min-h-0">
        <MonacoEditor
          height="100%"
          language={language}
          value={value}
          theme="custom-dark"
          onChange={handleEditorChange}
          onMount={(ed, monaco) => handleEditorDidMount(ed, monaco, quickParams)}
          options={{
            minimap: { enabled: false },
            fontSize: 14,
            fontFamily: "'JetBrains Mono', monospace",
            lineNumbers: "on",
            readOnly,
            scrollBeyondLastLine: false,
            automaticLayout: true,
            padding: { top: 16, bottom: 16 },
            smoothScrolling: true,
            cursorBlinking: "smooth",
            cursorSmoothCaretAnimation: "on",
            renderLineHighlight: "all",
            tabSize: 4,
            insertSpaces: true,
            scrollbar: {
              vertical: "visible",
              horizontal: "visible",
              useShadows: false,
              verticalHasArrows: false,
              horizontalHasArrows: false,
              verticalScrollbarSize: 10,
              horizontalScrollbarSize: 10,
            }
          }}
          loading={
            <div className="h-full w-full flex items-center justify-center bg-background text-muted-foreground gap-2">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>Initializing Editor...</span>
            </div>
          }
        />
      </div>
    </div>
  );
});
