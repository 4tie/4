import { Clock, Zap, FileCode, BarChart3, Activity } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type AIActionItem = {
  id: number | string;
  actionType?: string | null;
  description?: string | null;
  createdAt?: string | Date | null;
};

const iconForType = (type: string | null | undefined) => {
  const t = String(type || "").toLowerCase();
  if (t.includes("code")) return <FileCode className="w-3 h-3" />;
  if (t.includes("config")) return <FileCode className="w-3 h-3" />;
  if (t.includes("backtest")) return <BarChart3 className="w-3 h-3" />;
  if (t.includes("diagnostic")) return <Activity className="w-3 h-3" />;
  return <Zap className="w-3 h-3" />;
};

const formatTime = (value?: string | Date | null) => {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

export function AIActionTimeline({
  actions,
  variant = "full",
}: {
  actions: AIActionItem[];
  variant?: "full" | "compact";
}) {
  if (!Array.isArray(actions) || actions.length === 0) {
    return null;
  }

  const rows = actions.slice(0, variant === "compact" ? 6 : 20);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Clock className="w-3 h-3 text-muted-foreground" />
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">AI Actions</span>
      </div>
      <div className={cn("space-y-2", variant === "compact" && "text-xs")}>
        {rows.map((action) => (
          <div key={String(action.id)} className="flex items-start gap-2">
            <div className="mt-0.5 text-primary">{iconForType(action.actionType)}</div>
            <div className="flex-1">
              <div className="text-xs font-medium text-foreground">
                {action.description || action.actionType || "AI action"}
              </div>
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                {action.actionType && <Badge variant="outline">{action.actionType}</Badge>}
                <span>{formatTime(action.createdAt)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
      {variant === "compact" && actions.length > rows.length && (
        <div className="text-[10px] text-muted-foreground">Showing latest {rows.length} actions</div>
      )}
    </div>
  );
}
