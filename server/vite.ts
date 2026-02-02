import { type Express } from "express";
import { createServer as createViteServer, createLogger } from "vite";
import { type Server } from "http";
import viteConfig from "../vite.config";
import fs from "fs";
import path from "path";

const viteLogger = createLogger();

export async function setupVite(server: Server, app: Express) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server, path: "/vite-hmr" },
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        if (process.env.NODE_ENV === "production") {
          process.exit(1);
        }
      },
    },
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);

  // Catch-all route for SPA - only for non-API routes
  app.use("/{*pathParam}", async (req, res, next) => {
    const url = req.originalUrl;
    const requestPath = req.path;

    // Skip API routes and vite assets
    if (requestPath.startsWith("/api") || requestPath.startsWith("/@") || requestPath.includes(".")) {
      return next();
    }

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "..",
        "client",
        "index.html",
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      const page = await vite.transformIndexHtml(url, template);
      res
        .status(200)
        .set({ "Content-Type": "text/html", "Cache-Control": "no-store" })
        .end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}
