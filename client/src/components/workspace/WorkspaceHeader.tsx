import { Wifi, WifiOff, ChevronLeft, Loader2, Save, Play, Bot, ShieldCheck, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ConnectionStatus } from "@/lib/workspaceUtils";

interface WorkspaceHeaderProps {
  activeFilePath: string;
  isDirty: boolean;
  isSaving: boolean;
  isStrategyFile: boolean;
  isRunningBacktest: boolean;
  aiStatus: ConnectionStatus;
  cliStatus: ConnectionStatus;
  onNavigateBack: () => void;
  onSave: () => void;
  onRunBacktest: () => void;
  onValidate?: () => void;
  inlineEditsEnabled?: boolean;
  onToggleInlineEdits?: () => void;
}

function StatusPill({ label, status }: { label: string; status: ConnectionStatus }) {
  const ok = status === "connected";
  const checking = status === "checking";
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
        checking
          ? "border-purple-500/30 bg-purple-500/10 text-purple-200"
          : ok
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
            : "border-red-500/30 bg-red-500/10 text-red-400",
      )}
    >
      {ok ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
      <span>{label}</span>
    </div>
  );
}

export function WorkspaceHeader({
  activeFilePath,
  isDirty,
  isSaving,
  isStrategyFile,
  isRunningBacktest,
  aiStatus,
  cliStatus,
  onNavigateBack,
  onSave,
  onRunBacktest,
  onValidate,
  inlineEditsEnabled,
  onToggleInlineEdits,
}: WorkspaceHeaderProps) {
  return (
    <div className="h-12 border-b border-white/10 bg-black/30 backdrop-blur flex items-center justify-between px-3">
      <div className="flex items-center gap-3 min-w-0">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-xs gap-2 text-slate-200 hover:text-white hover:bg-white/5"
          onClick={onNavigateBack}
        >
          <ChevronLeft className="w-4 h-4" />
          IDE
        </Button>

        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-md bg-gradient-to-br from-purple-600/70 to-red-600/70 ring-1 ring-white/10 flex items-center justify-center">
            <Bot className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-bold tracking-[0.18em] uppercase text-purple-200">Workspace</div>
            <div className="text-[10px] text-slate-400 truncate">
              {activeFilePath ? activeFilePath.split("/").pop() : "No strategy selected"}
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <StatusPill label="AI" status={aiStatus} />
        <StatusPill label="CLI" status={cliStatus} />

        <Button
          variant="outline"
          size="sm"
          className="h-8 px-3 text-xs gap-2 bg-white/5 border-white/10 hover:bg-white/10 hover:text-white"
          onClick={onSave}
          disabled={!activeFilePath || !isDirty || isSaving}
        >
          {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          Save
        </Button>

        {onValidate && (
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-3 text-xs gap-2 bg-white/5 border-purple-500/30 text-purple-400 hover:bg-purple-500/10 hover:text-purple-300"
            onClick={onValidate}
            disabled={!isStrategyFile}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            Validate
          </Button>
        )}

        {onToggleInlineEdits && (
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-3 text-xs gap-2 bg-white/5 border-white/10 hover:bg-white/10 hover:text-white"
            onClick={onToggleInlineEdits}
            disabled={!isStrategyFile}
          >
            {inlineEditsEnabled ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            {inlineEditsEnabled ? "Hide edits" : "Show edits"}
          </Button>
        )}

        <Button
          size="sm"
          className="h-8 px-3 text-xs gap-2 bg-gradient-to-r from-purple-600 to-red-600 hover:from-purple-500 hover:to-red-500"
          onClick={onRunBacktest}
          disabled={!isStrategyFile || isRunningBacktest}
        >
          {isRunningBacktest ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
          Run
        </Button>
      </div>
    </div>
  );
}
