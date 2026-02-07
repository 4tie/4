import { useEffect } from "react";
import { useLocation } from "wouter";
import { AlertCircle, Home, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/ThemeProvider";

export default function NotFound() {
  const [, navigate] = useLocation();
  const { setTheme } = useTheme();

  useEffect(() => {
    setTheme("dark");
    const root = window.document.documentElement;
    root.classList.add("neo-world");
    return () => {
      root.classList.remove("neo-world");
    };
  }, [setTheme]);

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[hsl(250,60%,4%)] text-[hsl(220,18%,92%)]">
      <div className="w-full max-w-md mx-4 p-8 rounded-xl border border-white/10 bg-black/30 backdrop-blur-sm">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-3 rounded-lg bg-red-500/20">
            <AlertCircle className="h-8 w-8 text-red-400" />
          </div>
          <h1 className="text-2xl font-bold text-slate-100">404</h1>
        </div>

        <p className="text-lg text-slate-300 mb-2">Page Not Found</p>
        <p className="text-sm text-slate-400 mb-8">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>

        <div className="flex gap-3">
          <Button
            variant="outline"
            className="flex-1 border-white/10 bg-white/5 hover:bg-white/10 text-slate-200"
            onClick={() => navigate("/")}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Go Back
          </Button>
          <Button
            className="flex-1 bg-[hsl(272,92%,62%)] hover:bg-[hsl(272,92%,52%)] text-white"
            onClick={() => navigate("/")}
          >
            <Home className="h-4 w-4 mr-2" />
            Home
          </Button>
        </div>
      </div>
    </div>
  );
}
