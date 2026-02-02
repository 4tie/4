import { useState, useRef, useEffect } from "react";
import { Terminal as TerminalIcon, X, Maximize2, Minimize2, Send, Loader2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";

interface TerminalPanelProps {
  logs: string[];
  onCommand?: (command: string) => void;
}

export function TerminalPanel({ logs, onCommand }: TerminalPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [command, setCommand] = useState("");
  const [isExecuting, setIsExecuting] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const handleRunCommand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!command.trim() || isExecuting) return;

    const cmd = command.trim();
    setCommand("");
    setIsExecuting(true);
    
    // Optimistically show the command in logs
    if (onCommand) onCommand(`> ${cmd}`);

    try {
      const res = await apiRequest("POST", "/api/cmd", { command: cmd });
      const data = await res.json();
      if (onCommand && data.output) {
        onCommand(data.output);
      }
    } catch (error) {
      if (onCommand) onCommand("Error executing command.");
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <div className={cn(
      "flex flex-col bg-background border-t border-border transition-all duration-300",
      isExpanded ? "h-[500px]" : "h-full"
    )}>
      <div className="flex items-center justify-between px-4 py-2 bg-secondary/30 border-b border-border/50">
        <div className="flex items-center gap-2">
          <TerminalIcon className="w-4 h-4 text-muted-foreground" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Terminal</span>
        </div>
        <div className="flex items-center gap-1">
          <button 
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1 hover:bg-secondary rounded text-muted-foreground hover:text-foreground transition-colors"
          >
            {isExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
      
      <ScrollArea className="flex-1 p-4 font-mono text-sm">
        <div className="space-y-1">
          {logs.length === 0 && (
            <div className="text-muted-foreground/50 italic">Ready for input...</div>
          )}
          {logs.map((log, i) => (
            <div key={i} className="break-all whitespace-pre-wrap text-muted-foreground hover:bg-secondary/20 p-0.5 rounded px-2 transition-colors">
              {log.startsWith("> ") ? (
                <span className="text-blue-400 mr-2">$</span>
              ) : (
                <span className="text-green-500 mr-2">$</span>
              )}
              {log.startsWith("> ") ? log.substring(2) : log}
            </div>
          ))}
          <div ref={endRef} />
        </div>
      </ScrollArea>

      <div className="p-2 bg-secondary/10 border-t border-border/50">
        <form onSubmit={handleRunCommand} className="flex gap-2">
          <input
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            disabled={isExecuting}
            placeholder="Type a command..."
            className="flex-1 bg-background border border-border rounded px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary transition-all"
          />
          <button
            type="submit"
            disabled={isExecuting || !command.trim()}
            className="bg-primary text-primary-foreground px-3 py-1.5 rounded text-xs font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center gap-2"
          >
            {isExecuting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            Run
          </button>
        </form>
      </div>
    </div>
  );
}
