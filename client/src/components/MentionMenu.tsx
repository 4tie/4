import { useState, useEffect, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Globe, FileCode, Bot, Database, SlidersHorizontal } from "lucide-react";

export interface MentionItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  description?: string;
  action: () => void;
}

interface MentionMenuProps {
  isOpen: boolean;
  onClose: () => void;
  items: MentionItem[];
  onSelect: (item: MentionItem) => void;
  position?: { top: number; left: number };
}

export function MentionMenu({ isOpen, onClose, items, onSelect, position }: MentionMenuProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      setSelectedIndex(0);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) => (prev + 1) % items.length);
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) => (prev - 1 + items.length) % items.length);
          break;
        case "Enter":
          e.preventDefault();
          onSelect(items[selectedIndex]);
          break;
        case "Escape":
          onClose();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, items, selectedIndex, onSelect, onClose]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    if (isOpen) {
      window.addEventListener("mousedown", handleClickOutside);
    }

    return () => window.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, onClose]);

  if (!isOpen || items.length === 0) return null;

  const defaultPosition = { top: -280, left: 0 };
  const pos = position || defaultPosition;

  return (
    <div
      ref={menuRef}
      className={cn(
        "absolute z-50 w-64 rounded-lg border border-border/50",
        "bg-background/95 backdrop-blur-xl shadow-xl",
        "overflow-hidden animate-in fade-in zoom-in-95 duration-150"
      )}
      style={{
        top: pos.top,
        left: pos.left,
      }}
    >
      <div className="px-3 py-2 border-b border-border/30 bg-muted/30">
        <span className="text-xs font-medium text-muted-foreground">Mention</span>
      </div>
      <div className="py-1">
        {items.map((item, index) => (
          <button
            key={item.id}
            onClick={() => onSelect(item)}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2.5 text-left",
              "transition-colors duration-75",
              "hover:bg-primary/10",
              index === selectedIndex && "bg-primary/10"
            )}
          >
            <div className="flex-shrink-0 w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center text-primary">
              {item.icon}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{item.label}</div>
              {item.description && (
                <div className="text-xs text-muted-foreground truncate">{item.description}</div>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

export const defaultMentionItems = (context: {
  backtestResults?: any;
  fileName?: string;
  selectedCode?: string;
  onWebSearch?: () => void;
  onIncludeContext?: () => void;
  onIncludeCode?: () => void;
  onOptimizeParams?: () => void;
}): MentionItem[] => [
  {
    id: "web",
    label: "Web",
    icon: <Globe className="w-3.5 h-3.5" />,
    description: "Search the web for information",
    action: context.onWebSearch || (() => {}),
  },
  ...(context.fileName || context.backtestResults
    ? [
        {
          id: "context",
          label: "Context",
          icon: <Database className="w-3.5 h-3.5" />,
          description: context.fileName && context.backtestResults
            ? "Include file + backtest results"
            : context.fileName
            ? "Include current file"
            : "Include backtest results",
          action: context.onIncludeContext || (() => {}),
        },
      ]
    : []),
  ...(context.selectedCode
    ? [
        {
          id: "code",
          label: "Selected Code",
          icon: <FileCode className="w-3.5 h-3.5" />,
          description: "Include selected code snippet",
          action: context.onIncludeCode || (() => {}),
        },
      ]
    : []),
  ...(context.backtestResults
    ? [
        {
          id: "optimize",
          label: "Optimize Params",
          icon: <SlidersHorizontal className="w-3.5 h-3.5" />,
          description: "Tune parameters for better risk-adjusted returns",
          action: context.onOptimizeParams || (() => {}),
        },
      ]
    : []),
  {
    id: "ai",
    label: "AI Agent",
    icon: <Bot className="w-3.5 h-3.5" />,
    description: "Use AI agent for complex tasks",
    action: () => {},
  },
];

export function useMentionMenu(
  textareaRef: React.RefObject<HTMLTextAreaElement>,
  onItemSelect: (item: MentionItem) => void
) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState<{ top: number; left: number } | undefined>();

  const handleInput = useCallback(
    (value: string, cursorPosition: number) => {
      // Find the last @ before cursor
      const textBeforeCursor = value.slice(0, cursorPosition);
      const lastAtIndex = textBeforeCursor.lastIndexOf("@");

      if (lastAtIndex === -1) {
        setIsOpen(false);
        return;
      }

      // Check if there's a space after @ (which would close the menu)
      const textAfterAt = textBeforeCursor.slice(lastAtIndex + 1);
      const hasSpaceAfterAt = textAfterAt.includes(" ");

      if (hasSpaceAfterAt) {
        setIsOpen(false);
        return;
      }

      // Show menu
      setQuery(textAfterAt);
      setIsOpen(true);

      // Calculate position
      if (textareaRef.current) {
        const textarea = textareaRef.current;
        const lines = textBeforeCursor.slice(0, lastAtIndex).split("\n");
        const currentLineIndex = lines.length - 1;
        const currentLineText = lines[currentLineIndex];

        // Get line height (approximate)
        const lineHeight = 20;
        const charWidth = 8;

        // Calculate position based on cursor
        const top = (currentLineIndex + 1) * lineHeight + 10;
        const left = Math.min(currentLineText.length * charWidth, textarea.clientWidth - 260);

        setPosition({ top, left });
      }
    },
    [textareaRef]
  );

  const closeMenu = useCallback(() => {
    setIsOpen(false);
    setQuery("");
  }, []);

  const selectItem = useCallback(
    (item: MentionItem) => {
      onItemSelect(item);
      closeMenu();
    },
    [onItemSelect, closeMenu]
  );

  return {
    isOpen,
    query,
    position,
    handleInput,
    closeMenu,
    selectItem,
  };
}
