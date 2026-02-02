import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2 } from "lucide-react";
import { useApplyStrategyParams, useStrategyParams } from "@/hooks/use-strategy-params";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  strategyPath: string | null;
};

function toPyLiteral(input: string): string {
  const raw = String(input ?? "").trim();
  if (!raw) throw new Error("Default value is required");

  if (/^-?\d+(?:\.\d+)?$/.test(raw)) return raw;

  const lower = raw.toLowerCase();
  if (lower === "true") return "True";
  if (lower === "false") return "False";

  if ((raw.startsWith("\"") && raw.endsWith("\"")) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw;
  }

  return JSON.stringify(raw);
}

function updateDefaultSegment(before: string, nextDefaultExpr: string): string {
  const re = /default\s*=\s*([^,\)]+)/m;
  if (re.test(before)) {
    return before.replace(re, (m) => {
      const idx = m.indexOf("=");
      if (idx < 0) return `default=${nextDefaultExpr}`;
      return `${m.slice(0, idx + 1)} ${nextDefaultExpr}`;
    });
  }

  const closeIdx = before.lastIndexOf(")");
  if (closeIdx < 0) return before;

  let prev = closeIdx - 1;
  while (prev >= 0 && /\s/.test(before[prev])) prev--;
  const prevChar = prev >= 0 ? before[prev] : "";

  const insert = prevChar === "(" || prevChar === "," ? ` default=${nextDefaultExpr}` : `, default=${nextDefaultExpr}`;
  return before.slice(0, closeIdx) + insert + before.slice(closeIdx);
}

export function StrategyParamsDialog({ open, onOpenChange, strategyPath }: Props) {
  const { data, isLoading, error, refetch } = useStrategyParams(strategyPath, open);
  const apply = useApplyStrategyParams();

  const params = data?.params ?? [];

  const [drafts, setDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    if (!strategyPath) return;
    const next: Record<string, string> = {};
    for (const p of params) {
      if (p?.name) {
        const d = p.default;
        if (typeof d === "number") next[p.name] = String(d);
        else if (typeof d === "boolean") next[p.name] = d ? "true" : "false";
        else if (typeof d === "string") next[p.name] = d;
        else if (d === null || d === undefined) next[p.name] = "";
        else next[p.name] = JSON.stringify(d);
      }
    }
    setDrafts(next);
  }, [open, strategyPath, params.length]);

  const computedChanges = useMemo(() => {
    const changes: Array<{ name: string; before: string; after: string }> = [];
    for (const p of params) {
      const nextRaw = drafts[p.name];
      if (nextRaw === undefined) continue;
      if (String(nextRaw).trim() === "") continue;

      let nextExpr: string;
      try {
        nextExpr = toPyLiteral(nextRaw);
      } catch {
        continue;
      }

      const after = updateDefaultSegment(p.before, nextExpr);
      if (after !== p.before) {
        changes.push({ name: p.name, before: p.before, after });
      }
    }
    return changes;
  }, [params, drafts]);

  const canApply = Boolean(strategyPath) && computedChanges.length > 0 && !apply.isPending;

  return (
    <Dialog open={open} onOpenChange={(v) => onOpenChange(v)}>
      <DialogContent className="sm:max-w-[900px]">
        <DialogHeader>
          <DialogTitle>Strategy Parameters</DialogTitle>
        </DialogHeader>

        {!strategyPath ? (
          <div className="text-sm text-muted-foreground">Open a strategy file first.</div>
        ) : isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading parameters...
          </div>
        ) : error ? (
          <div className="space-y-3">
            <div className="text-sm text-destructive">{String((error as any)?.message || "Failed to load")}</div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" onClick={() => refetch()}>
                Retry
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs text-muted-foreground break-all">{strategyPath}</div>
              <Button
                type="button"
                disabled={!canApply}
                onClick={() => {
                  if (!strategyPath) return;
                  apply.mutate({ strategyPath, changes: computedChanges });
                }}
              >
                Apply ({computedChanges.length})
              </Button>
            </div>

            <ScrollArea className="h-[60vh] pr-3">
              <div className="space-y-2">
                {params.map((p) => (
                  <div key={p.name} className="rounded-md border border-border/60 p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="font-medium text-sm truncate">{p.name}</div>
                        <Badge variant="outline" className="text-[10px]">
                          {p.type}
                        </Badge>
                      </div>
                      <div className="text-[10px] text-muted-foreground">L{p.line}</div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-start">
                      <div className="space-y-1">
                        <div className="text-[10px] text-muted-foreground">Current default</div>
                        <div className="text-xs font-mono break-all">{p.default === undefined ? "-" : JSON.stringify(p.default)}</div>
                      </div>

                      <div className="space-y-1">
                        <div className="text-[10px] text-muted-foreground">New default</div>
                        <Input
                          value={drafts[p.name] ?? ""}
                          onChange={(e) => setDrafts((prev) => ({ ...prev, [p.name]: e.target.value }))}
                          placeholder="number | true/false | string"
                        />
                      </div>

                      <div className="space-y-1">
                        <div className="text-[10px] text-muted-foreground">Preview</div>
                        <div className="text-xs font-mono whitespace-pre-wrap break-words max-h-24 overflow-auto rounded bg-muted/20 border border-border/40 p-2">
                          {(() => {
                            const nextRaw = drafts[p.name];
                            if (!nextRaw || !String(nextRaw).trim()) return p.before;
                            try {
                              const nextExpr = toPyLiteral(nextRaw);
                              return updateDefaultSegment(p.before, nextExpr);
                            } catch {
                              return p.before;
                            }
                          })()}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
