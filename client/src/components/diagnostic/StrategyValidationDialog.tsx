import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, CheckCircle2, AlertCircle, FileCode2, Diff, Play, Save, X, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { DiffEditor } from "@monaco-editor/react";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  code: string;
  diff: string;
  changes: {
    type: "add_filter" | "add_indicator" | "add_helper" | "modify_entry" | "modify_exit" | "risk_management";
    description: string;
    targetLine?: number;
    snippet: string;
  }[];
}

interface StrategyValidationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  originalCode: string;
  strategyName: string;
  onValidate: () => Promise<ValidationResult>;
  onApply: (code: string) => Promise<void>;
  onSave: (code: string) => Promise<void>;
}

export function StrategyValidationDialog({
  open,
  onOpenChange,
  originalCode,
  strategyName,
  onValidate,
  onApply,
  onSave,
}: StrategyValidationDialogProps) {
  const [validating, setValidating] = useState(false);
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [activeTab, setActiveTab] = useState("preview");
  const [applied, setApplied] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => setMounted(true), 50);
      return () => clearTimeout(timer);
    } else {
      setMounted(false);
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
    try {
      const validationResult = await onValidate();
      setResult(validationResult);
    } catch (error) {
      setResult({
        valid: false,
        errors: ["Validation failed: " + (error as Error).message],
        warnings: [],
        code: originalCode,
        diff: "",
        changes: [],
      });
    } finally {
      setValidating(false);
    }
  };

  const handleApply = async () => {
    if (!result?.code) return;
    await onApply(result.code);
    setApplied(true);
  };

  const handleSave = async () => {
    if (!result?.code) return;
    await onSave(result.code);
    onOpenChange(false);
    setResult(null);
  };

  const handleCancel = () => {
    onOpenChange(false);
    setResult(null);
    setApplied(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleCancel}>
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

        {validating ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-purple-400" />
            <p className="text-sm text-slate-400">Validating strategy code...</p>
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
            </TabsList>

            <TabsContent value="preview" className="flex-1 min-h-0 mt-0 pt-4">
              <div className="h-full rounded-md border border-white/10 overflow-hidden">
                {mounted && result && (
                  <DiffEditor
                    key={`diff-${result.code.length}-${result.code.slice(0, 50)}`}
                    height="100%"
                    language="python"
                    theme="vs-dark"
                    original={originalCode}
                    modified={result.code}
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
                disabled={!applied}
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
