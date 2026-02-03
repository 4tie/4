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

export const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(({ language, value, onChange, onSave, onEditorStateChange, readOnly = false, onToggleChat, isChatOpen }, ref) => {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    setIsDirty(false);
  }, [value]);

  const handleEditorChange = (val: string | undefined) => {
    setIsDirty(val !== value);
    onChange?.(val);
  };

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
      });
    });

  }, [onEditorStateChange, handleSave, onToggleChat]);

  return (
    <div className="flex flex-col h-full w-full overflow-hidden rounded-md border border-border/50 shadow-inner bg-[#1e1e1e]">
      <div className="flex-1 min-h-0">
        <MonacoEditor
          height="100%"
          language={language}
          value={value}
          theme="custom-dark"
          onChange={handleEditorChange}
          onMount={handleEditorMount}
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
