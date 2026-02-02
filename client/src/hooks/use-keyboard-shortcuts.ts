import { useEffect } from 'react';

export interface Shortcut {
  key: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  description: string;
  action: () => void;
}

export function useKeyboardShortcuts(shortcuts: Shortcut[]) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.repeat) return;

      if (e.metaKey) return;

      const key = String(e.key || "");
      const pressed = key.length === 1 ? key.toUpperCase() : key;
      
      const shortcut = shortcuts.find(s => 
        (String(s.key || "").length === 1 ? String(s.key).toUpperCase() : String(s.key)) === pressed &&
        e.altKey === !!s.altKey &&
        e.ctrlKey === !!s.ctrlKey &&
        (s.shiftKey === undefined || s.shiftKey === e.shiftKey)
      );

      if (shortcut) {
        e.preventDefault();
        shortcut.action();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [shortcuts]);
}

export function getShortcutLabel(shortcut: Omit<Shortcut, 'action'>): string {
  const parts: string[] = [];
  if (shortcut.ctrlKey) parts.push('Ctrl');
  if (shortcut.altKey) parts.push('Alt');
  if (shortcut.shiftKey) parts.push('Shift');
  parts.push(shortcut.key.toUpperCase());
  return parts.join('+');
}
