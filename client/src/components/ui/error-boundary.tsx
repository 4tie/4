import { Component, ReactNode, ErrorInfo } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw, Copy } from "lucide-react";
import { reportErrorOnce } from "@/lib/reportError";

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  componentName?: string;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null, errorInfo: null };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    
    const componentName = this.props.componentName || "UnknownComponent";
    reportErrorOnce(`ErrorBoundary:${componentName}`, `Component ${componentName} crashed`, error, {
      showToast: true,
    });

    this.props.onError?.(error, errorInfo);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    if (prevProps.children !== this.props.children && this.state.hasError) {
      this.setState({ hasError: false, error: null, errorInfo: null });
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  handleCopyError = () => {
    if (this.state.error) {
      const errorText = `${this.state.error?.message}\n\nStack:\n${this.state.errorInfo?.componentStack || "N/A"}`;
      navigator.clipboard.writeText(errorText);
    }
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex flex-col items-center justify-center p-8 min-h-[300px] bg-red-500/5 border border-red-500/20 rounded-xl">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-3 rounded-full bg-red-500/20">
              <AlertTriangle className="w-6 h-6 text-red-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-red-400">Something went wrong</h2>
              <p className="text-sm text-slate-400">An unexpected error occurred in this component</p>
            </div>
          </div>

          {this.state.error && (
            <div className="w-full max-w-lg p-4 mb-4 bg-black/40 rounded-lg border border-white/10">
              <p className="text-sm text-slate-300 font-medium mb-2">Error Details:</p>
              <p className="text-xs text-red-300 font-mono break-all">{this.state.error.message}</p>
            </div>
          )}

          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={this.handleRetry}
              className="border-white/10 hover:bg-white/5"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Try Again
            </Button>
            <Button
              variant="ghost"
              onClick={this.handleCopyError}
              className="text-slate-400 hover:text-white hover:bg-white/5"
            >
              <Copy className="w-4 h-4 mr-2" />
              Copy Error
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

interface AsyncErrorBoundaryProps {
  children: ReactNode;
  loading?: ReactNode;
}

interface AsyncErrorBoundaryState {
  isError: boolean;
  error: Error | null;
}

export class AsyncErrorBoundary extends Component<AsyncErrorBoundaryProps, AsyncErrorBoundaryState> {
  state: AsyncErrorBoundaryState = { isError: false, error: null };

  static getDerivedStateFromError(error: Error): Partial<AsyncErrorBoundaryState> {
    return { isError: true, error };
  }

  componentDidCatch(error: Error) {
    reportErrorOnce("AsyncErrorBoundary", "Async operation failed", error, { showToast: true });
  }

  handleRetry = () => {
    this.setState({ isError: false, error: null });
  };

  render() {
    if (this.state.isError) {
      return (
        <div className="flex flex-col items-center justify-center p-6 min-h-[200px] bg-red-500/5 border border-red-500/10 rounded-lg">
          <AlertTriangle className="w-8 h-8 text-red-400 mb-3" />
          <p className="text-sm text-slate-300 mb-3">
            {this.state.error?.message || "Operation failed"}
          </p>
          <Button variant="outline" size="sm" onClick={this.handleRetry} className="border-white/10">
            <RefreshCw className="w-3 h-3 mr-2" />
            Retry
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
