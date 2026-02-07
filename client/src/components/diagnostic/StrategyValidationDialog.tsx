import { useState, useEffect, useMemo, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, CheckCircle2, AlertCircle, FileCode2, Diff, Play, Save, X, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { DiffEditor } from "@monaco-editor/react";

type StrategyEdit = any;

export interface ValidationResult {
  validationId?: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
  changes: {
    type: "add_filter" | "add_indicator" | "add_helper" | "modify_entry" | "modify_exit" | "risk_management";
    description: string;
    targetLine?: number;
    snippet: string;
  }[];
  edits?: StrategyEdit[];
}

interface StrategyValidationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  originalCode: string;
  strategyName: string;
  onValidate: () => Promise<ValidationResult>;
  onPreviewEdits: (payload: { strategyPath: string; edits: StrategyEdit[] }) => Promise<{ diff?: string; content?: string }>;
  onApplyToEditor: (code: string) => Promise<void>;
  onApplyEditsAndSave: (payload: { strategyPath: string; edits: StrategyEdit[] }) => Promise<void>;
  onMarkValidation?: (payload: { validationId: string; applied?: boolean; saved?: boolean }) => Promise<void>;
}

export function StrategyValidationDialog({
  open,
  onOpenChange,
  originalCode,
  strategyName,
  onValidate,
  onPreviewEdits,
  onApplyToEditor,
  onApplyEditsAndSave,
  onMarkValidation,
}: StrategyValidationDialogProps) {
  const [validating, setValidating] = useState(false);
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [activeTab, setActiveTab] = useState("preview");
  const [applied, setApplied] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [preview, setPreview] = useState<{ diff: string; content: string } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const instanceIdRef = useRef<string>(Math.random().toString(36).slice(2));

  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => setMounted(true), 50);
      return () => clearTimeout(timer);
    } else {
      setMounted(false);
      const timer = setTimeout(() => {
        setResult(null);
        setApplied(false);
        setPreview(null);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [open]);

  useEffect(() => {
    if (open && !result && !validating) {
      handleValidate();
    }
  }, [open]);

  const handleValidate = async () => {
    setValidating(true);
    setApplied(false);
    setPreview(null);
    try {
      const validationResult = await onValidate();
      setResult(validationResult);
      if (validationResult.valid && Array.isArray(validationResult.edits) && validationResult.edits.length > 0) {
        setPreviewing(true);
        try {
          const r = await onPreviewEdits({ strategyPath: strategyName, edits: validationResult.edits });
          setPreview({
            diff: typeof r?.diff === "string" ? r.diff : "",
            content: typeof r?.content === "string" ? r.content : originalCode,
          });
        } finally {
          setPreviewing(false);
        }
      }
    } catch (error) {
      setResult({
        valid: false,
        errors: ["Validation failed: " + (error as Error).message],
        warnings: [],
        changes: [],
      });
    } finally {
      setValidating(false);
    }
  };

  const handleApply = async () => {
    if (!result?.valid) return;
    if (!preview?.content) return;
    await onApplyToEditor(preview.content);
    setApplied(true);
    if (onMarkValidation && typeof result.validationId === "string" && result.validationId) {
      await onMarkValidation({ validationId: result.validationId, applied: true });
    }
  };

  const handleSave = async () => {
    if (!result?.valid) return;
    if (!applied) return;
    const edits = Array.isArray(result.edits) ? result.edits : [];
    if (edits.length === 0) return;
    await onApplyEditsAndSave({ strategyPath: strategyName, edits });
    if (onMarkValidation && typeof result.validationId === "string" && result.validationId) {
      await onMarkValidation({ validationId: result.validationId, saved: true });
    }
    onOpenChange(false);
    setResult(null);
  };

  const handleCancel = () => {
    onOpenChange(false);
    setApplied(false);
  };

  const handleDialogOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      handleCancel();
      return;
    }
    onOpenChange(true);
  };

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="max-w-5xl h-[80vh] flex flex-col bg-gradient-to-br from-[#0a0a0f] via-[#12121a] to-[#1a1a24] border-white/10 text-slate-100">
        <DialogHeader className="flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-purple-400" />
              <DialogTitle className="text-lg font-semibold text-slate-100">
                Strategy Validation Preview
              </DialogTitle>
            </div>
            {result && (
              <div className="flex items-center gap-2">
                {result.valid ? (
                  <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                    <CheckCircle2 className="w-3 h-3 mr-1" />
                    Valid
                  </Badge>
                ) : (
                  <Badge className="bg-red-500/20 text-red-400 border-red-500/30">
                    <AlertCircle className="w-3 h-3 mr-1" />
                    Issues Found
                  </Badge>
                )}
                {result.changes.length > 0 && (
                  <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30">
                    {result.changes.length} Changes
                  </Badge>
                )}
              </div>
            )}
          </div>
          <DialogDescription className="text-slate-400">
            {strategyName} • Review AI-suggested changes before applying
          </DialogDescription>
        </DialogHeader>

        {validating || previewing ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-purple-400" />
            <p className="text-sm text-slate-400">{validating ? "Validating strategy code..." : "Building server preview..."}</p>
          </div>
        ) : result ? (
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
            <TabsList className="flex-shrink-0 bg-black/30 border-white/10">
              <TabsTrigger value="preview" className="data-[state=active]:bg-white/10">
                <Diff className="w-4 h-4 mr-1" />
                Diff Preview
              </TabsTrigger>
              <TabsTrigger value="changes" className="data-[state=active]:bg-white/10">
                <FileCode2 className="w-4 h-4 mr-1" />
                Changes ({result.changes.length})
              </TabsTrigger>
              {result.errors.length > 0 && (
                <TabsTrigger value="errors" className="data-[state=active]:bg-white/10 text-red-400">
                  <AlertCircle className="w-4 h-4 mr-1" />
                  Errors ({result.errors.length})
                </TabsTrigger>
              )}
              {result.warnings.length > 0 && (
                <TabsTrigger value="warnings" className="data-[state=active]:bg-white/10 text-amber-400">
                  <AlertCircle className="w-4 h-4 mr-1" />
                  Warnings ({result.warnings.length})
                </TabsTrigger>
              )}
              <TabsTrigger value="diff_raw" className="data-[state=active]:bg-white/10">
                <Diff className="w-4 h-4 mr-1" />
                Validated Diff
              </TabsTrigger>
            </TabsList>

            <TabsContent value="preview" className="flex-1 min-h-0 mt-0 pt-4">
              <div className="flex flex-col h-full gap-4">
                <div className="grid grid-cols-2 gap-4 h-[45%]">
                  <div className="flex flex-col min-h-0 border border-white/10 rounded-lg overflow-hidden bg-black/20">
                    <div className="px-3 py-1.5 bg-white/5 border-b border-white/10 flex items-center justify-between">
                      <span className="text-xs font-medium text-slate-400">Original Logic</span>
                      <Badge variant="outline" className="text-[10px] py-0 border-white/10 text-slate-500">ReadOnly</Badge>
                    </div>
                    <div className="flex-1 min-h-0">
                      {mounted && result && (
                        <DiffEditor
                          height="100%"
                          language="python"
                          theme="vs-dark"
                          original={originalCode}
                          modified={originalCode}
                          originalModelPath={`inmemory://strategy-validation/${instanceIdRef.current}/${strategyName}/original-view/original.py`}
                          modifiedModelPath={`inmemory://strategy-validation/${instanceIdRef.current}/${strategyName}/original-view/modified.py`}
                          options={{
                            readOnly: true,
                            renderSideBySide: false,
                            minimap: { enabled: false },
                            lineNumbers: "on",
                            folding: true,
                            fontSize: 12,
                            fontFamily: "'JetBrains Mono', monospace",
                            automaticLayout: true,
                            scrollBeyondLastLine: false,
                          }}
                        />
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col min-h-0 border border-purple-500/20 rounded-lg overflow-hidden bg-purple-500/5">
                    <div className="px-3 py-1.5 bg-purple-500/10 border-b border-purple-500/20 flex items-center justify-between">
                      <span className="text-xs font-medium text-purple-300">AI Proposed Improvement</span>
                      <Badge className="bg-purple-500/20 text-purple-300 border-purple-500/30 text-[10px] py-0">Improved</Badge>
                    </div>
                    <div className="flex-1 min-h-0">
                      {mounted && result && (
                        <DiffEditor
                          height="100%"
                          language="python"
                          theme="vs-dark"
                          original={preview?.content ?? originalCode}
                          modified={preview?.content ?? originalCode}
                          originalModelPath={`inmemory://strategy-validation/${instanceIdRef.current}/${strategyName}/improved-view/original.py`}
                          modifiedModelPath={`inmemory://strategy-validation/${instanceIdRef.current}/${strategyName}/improved-view/modified.py`}
                          options={{
                            readOnly: true,
                            renderSideBySide: false,
                            minimap: { enabled: false },
                            lineNumbers: "on",
                            folding: true,
                            fontSize: 12,
                            fontFamily: "'JetBrains Mono', monospace",
                            automaticLayout: true,
                            scrollBeyondLastLine: false,
                          }}
                        />
                      )}
                    </div>
                  </div>
                </div>

                <div className="h-[55%] rounded-lg border border-white/10 overflow-hidden bg-black/40 flex flex-col">
                  <div className="px-3 py-1.5 bg-white/5 border-b border-white/10 flex items-center gap-2">
                    <Diff className="w-3.5 h-3.5 text-blue-400" />
                    <span className="text-xs font-medium text-slate-300">Comparative Diff</span>
                  </div>
                  <div className="flex-1 min-h-0">
                    {mounted && result && (
                      <DiffEditor
                        height="100%"
                        language="python"
                        theme="vs-dark"
                        original={originalCode}
                        modified={preview?.content ?? originalCode}
                        originalModelPath={`inmemory://strategy-validation/${instanceIdRef.current}/${strategyName}/diff/original.py`}
                        modifiedModelPath={`inmemory://strategy-validation/${instanceIdRef.current}/${strategyName}/diff/modified.py`}
                        options={{
                          readOnly: true,
                          renderSideBySide: true,
                          minimap: { enabled: false },
                          scrollBeyondLastLine: false,
                          automaticLayout: true,
                          fontSize: 12,
                          fontFamily: "'JetBrains Mono', monospace",
                          diffWordWrap: "on",
                        }}
                      />
                    )}
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="diff_raw" className="flex-1 min-h-0 mt-0 pt-4">
              <div className="h-full rounded-md border border-white/10 bg-black/40 overflow-hidden flex flex-col">
                <div className="px-4 py-2 border-b border-white/10 bg-white/5 flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-300">Validated Unified Diff</span>
                  <div className="flex gap-4 text-[10px] uppercase tracking-wider font-bold">
                    <span className="text-emerald-400">+ Additions</span>
                    <span className="text-red-400">- Deletions</span>
                  </div>
                </div>
                <ScrollArea className="flex-1">
                  <div className="p-4 font-mono text-xs leading-relaxed">
                    {(preview?.diff ?? "").split('\n').map((line, i) => {
                      const isAdded = line.startsWith('+') && !line.startsWith('+++');
                      const isRemoved = line.startsWith('-') && !line.startsWith('---');
                      const isHeader = line.startsWith('@@') || line.startsWith('---') || line.startsWith('+++');
                      
                      return (
                        <div 
                          key={i} 
                          className={cn(
                            "whitespace-pre py-0.5 px-2 -mx-2 rounded-sm",
                            isAdded && "bg-emerald-500/10 text-emerald-300 border-l-2 border-emerald-500",
                            isRemoved && "bg-red-500/10 text-red-300 border-l-2 border-red-500",
                            isHeader && "text-blue-400 font-bold bg-blue-500/5",
                            !isAdded && !isRemoved && !isHeader && "text-slate-400 opacity-80"
                          )}
                        >
                          {line}
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              </div>
            </TabsContent>

            <TabsContent value="changes" className="flex-1 min-h-0 mt-0 pt-4">
              <ScrollArea className="h-full">
                <div className="space-y-3 pr-4">
                  {result.changes.map((change, idx) => (
                    <div
                      key={idx}
                      className="rounded-lg border border-white/10 bg-black/30 p-4 hover:border-purple-500/30 transition-colors"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <Badge
                          className={cn(
                            "text-[10px]",
                            change.type.includes("add")
                              ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                              : "bg-amber-500/20 text-amber-400 border-amber-500/30"
                          )}
                        >
                          {change.type.replace("_", " ")}
                        </Badge>
                        {change.targetLine && (
                          <span className="text-[10px] text-slate-500">Line {change.targetLine}</span>
                        )}
                      </div>
                      <p className="text-sm text-slate-300 mb-2">{change.description}</p>
                      <pre className="text-xs bg-black/50 rounded p-2 overflow-x-auto text-slate-400 font-mono">
                        {change.snippet}
                      </pre>
                    </div>
                  ))}
                  {result.changes.length === 0 && (
                    <div className="text-center text-slate-500 py-8">No changes proposed</div>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="errors" className="flex-1 min-h-0 mt-0 pt-4">
              <ScrollArea className="h-full">
                <div className="space-y-2 pr-4">
                  {result.errors.map((error, idx) => (
                    <div
                      key={idx}
                      className="flex items-start gap-2 p-3 rounded-lg border border-red-500/20 bg-red-500/10"
                    >
                      <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
                      <span className="text-sm text-red-200">{error}</span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="warnings" className="flex-1 min-h-0 mt-0 pt-4">
              <ScrollArea className="h-full">
                <div className="space-y-2 pr-4">
                  {result.warnings.map((warning, idx) => (
                    <div
                      key={idx}
                      className="flex items-start gap-2 p-3 rounded-lg border border-amber-500/20 bg-amber-500/10"
                    >
                      <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
                      <span className="text-sm text-amber-200">{warning}</span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        ) : null}

        <DialogFooter className="flex-shrink-0 gap-2">
          <Button
            variant="ghost"
            onClick={handleCancel}
            className="text-slate-400 hover:text-slate-200 hover:bg-white/5"
          >
            <X className="w-4 h-4 mr-1" />
            Cancel
          </Button>
          {result && !validating && (
            <>
              {!result.valid && (
                <div className="mr-auto text-xs text-red-300/80">
                  Fix validation errors before applying or saving.
                </div>
              )}
              <Button
                variant="outline"
                onClick={handleValidate}
                className="border-white/10 text-slate-300 hover:bg-white/5"
              >
                <Play className="w-4 h-4 mr-1" />
                Re-validate
              </Button>
              <Button
                variant="outline"
                onClick={handleApply}
                disabled={applied || !result.valid}
                className={cn(
                  "border-white/10",
                  applied
                    ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                    : "text-slate-300 hover:bg-white/5"
                )}
              >
                {applied ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 mr-1" />
                    Applied
                  </>
                ) : (
                  <>
                    <Diff className="w-4 h-4 mr-1" />
                    Apply to Editor
                  </>
                )}
              </Button>
              <Button
                onClick={handleSave}
                disabled={!applied || !result.valid}
                className="bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-500 hover:to-purple-600 text-white"
              >
                <Save className="w-4 h-4 mr-1" />
                Apply & Save
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
