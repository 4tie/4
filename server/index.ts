import "../env";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import type { AddressInfo } from "net";

const app = express();
const httpServer = createServer(app);

app.set("etag", false);
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

function safeStringifyForLog(value: unknown, maxChars: number) {
  try {
    const json = JSON.stringify(value);
    if (typeof json !== "string") return "";
    if (json.length <= maxChars) return json;
    return `${json.slice(0, maxChars)}...(truncated)`;
  } catch {
    return "[unserializable]";
  }
}

const logApiAll = process.env.LOG_API_ALL === "1";
const logApiBodies = process.env.LOG_API_BODIES === "1";
const logApiMaxBodyChars = Number.isFinite(Number(process.env.LOG_API_MAX_BODY_CHARS))
  ? Number(process.env.LOG_API_MAX_BODY_CHARS)
  : 2000;

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: unknown = undefined;

  if (logApiBodies) {
    const originalResJson = res.json;
    res.json = function (bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };
  }

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      if (!logApiAll && res.statusCode < 400) return;
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (logApiBodies && capturedJsonResponse !== undefined) {
        logLine += ` :: ${safeStringifyForLog(capturedJsonResponse, logApiMaxBodyChars)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Register API routes FIRST
  await registerRoutes(httpServer, app);

  // Add 404 handler for unmatched API routes
  app.use("/api", (req, res) => {
    res.status(404).json({ message: "API endpoint not found" });
  });

  // Error handler
  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // Setup Vite AFTER all API routes
  // The catch-all route in Vite will only match non-API routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const isReplit = Boolean(process.env.REPL_ID || process.env.REPL_SLUG || process.env.REPLIT_DEPLOYMENT);
  const defaultPort = isReplit ? 5000 : 5173;
  const port = parseInt(process.env.PORT || String(defaultPort), 10);
  const host = process.env.HOST || "100.67.174.2";
  const strictPort = process.env.STRICT_PORT === "1";

  const listenWithFallback = (startPort: number, attempts: number) => {
    const tryListen = (p: number, remaining: number) => {
      httpServer.once("error", (err: any) => {
        if (
          err?.code === "EADDRINUSE" &&
          process.env.NODE_ENV !== "production" &&
          !strictPort &&
          remaining > 0
        ) {
          tryListen(p + 1, remaining - 1);
          return;
        }
        throw err;
      });

      httpServer.listen(
        {
          port: p,
          host,
          reusePort: process.env.NODE_ENV === "production",
        },
        () => {
          const addr = httpServer.address() as AddressInfo | null;
          log(`serving on port ${addr?.port ?? p}`);
        },
      );
    };

    tryListen(startPort, attempts);
  };

  listenWithFallback(port, 10);
})();
