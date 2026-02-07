import { useEffect, useRef } from "react";
import { useTheme } from "@/components/ThemeProvider";

export function useWorkspaceTheme() {
  const { theme, setTheme } = useTheme();
  const prevThemeRef = useRef(theme);

  useEffect(() => {
    setTheme("dark");
    const root = window.document.documentElement;
    root.classList.add("neo-world");

    const applySafeBottom = () => {
      const viewportH = window.visualViewport?.height ?? window.innerHeight;
      const screenH = window.screen?.height ?? viewportH;
      const nearFullscreen = Math.abs(viewportH - screenH) <= 4;
      const isFullscreen = Boolean(document.fullscreenElement);
      const safeBottomPx = (nearFullscreen || isFullscreen) ? 92 : 0;
      root.style.setProperty("--workspace-safe-bottom", `${safeBottomPx}px`);
    };

    applySafeBottom();
    window.addEventListener("resize", applySafeBottom);
    window.addEventListener("fullscreenchange", applySafeBottom);

    return () => {
      window.removeEventListener("resize", applySafeBottom);
      window.removeEventListener("fullscreenchange", applySafeBottom);
      root.style.removeProperty("--workspace-safe-bottom");
      root.classList.remove("neo-world");
      setTheme(prevThemeRef.current);
    };
  }, [setTheme]);

  useEffect(() => {
    if (theme !== "dark") setTheme("dark");
  }, [theme, setTheme]);

  return { theme };
}
