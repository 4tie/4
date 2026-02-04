import { db } from "./db";
import { and, eq, desc, asc, gt, sql } from "drizzle-orm";
import {
  files as filesTable, backtests, diagnosticReports,
  diagnosticChangeTargets,
  diagnosticJobs,
  diagnosticLoopRuns,
  diagnosticLoopIterations,
  aiChatSessions,
  aiChatMessages,
  aiAuditEvents,
  aiActions,
  agentHandoffs,
  type File, type InsertFile,
  type Backtest, type InsertBacktest,
  type DiagnosticReport, type InsertDiagnosticReport,
  type DiagnosticChangeTarget, type InsertDiagnosticChangeTarget,
  type DiagnosticJob, type InsertDiagnosticJob,
  type DiagnosticLoopRun, type InsertDiagnosticLoopRun,
  type DiagnosticLoopIteration, type InsertDiagnosticLoopIteration,
  type AiChatSession,
  type AiChatMessage, type InsertAiChatMessage,
  type AiAuditEvent, type InsertAiAuditEvent,
  type AiAction, type InsertAiAction,
  type AgentHandoff, type InsertAgentHandoff
} from "@shared/schema";
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { glob } from "glob";

export interface IStorage {
  // Files
  getFiles(): Promise<File[]>;
  getFile(id: number): Promise<File | undefined>;
  getFileByPath(path: string): Promise<File | undefined>;
  createFile(file: InsertFile): Promise<File>;
  updateFile(id: number, content: string): Promise<File>;
  deleteFile(id: number): Promise<void>;
  syncWithFilesystem(): Promise<void>;

  // Backtests
  getBacktests(): Promise<Backtest[]>;
  getBacktest(id: number): Promise<Backtest | undefined>;
  createBacktest(backtest: InsertBacktest): Promise<Backtest>;
  updateBacktestStatus(id: number, status: string, results?: any, logs?: string[]): Promise<Backtest>;
  appendBacktestLog(id: number, logLine: string): Promise<void>;

  // Diagnostics
  createDiagnosticReport(report: InsertDiagnosticReport): Promise<DiagnosticReport>;
  createDiagnosticChangeTargets(targets: InsertDiagnosticChangeTarget): Promise<DiagnosticChangeTarget | null>;
  getDiagnosticReport(id: number): Promise<DiagnosticReport | undefined>;
  getDiagnosticReportByReportId(reportId: string): Promise<DiagnosticReport | undefined>;
  getDiagnosticReports(backtestId?: number): Promise<DiagnosticReport[]>;

  // Diagnostic Jobs
  createDiagnosticJob(job: InsertDiagnosticJob): Promise<DiagnosticJob>;
  updateDiagnosticJob(id: string, patch: Partial<DiagnosticJob>): Promise<DiagnosticJob>;
  getDiagnosticJob(id: string): Promise<DiagnosticJob | undefined>;
  getDiagnosticJobs(backtestId?: number): Promise<DiagnosticJob[]>;

  // Diagnostic Loop
  createDiagnosticLoopRun(run: InsertDiagnosticLoopRun): Promise<DiagnosticLoopRun>;
  updateDiagnosticLoopRun(id: string, patch: Partial<DiagnosticLoopRun>): Promise<DiagnosticLoopRun>;
  getDiagnosticLoopRun(id: string): Promise<DiagnosticLoopRun | undefined>;
  getDiagnosticLoopRuns(): Promise<DiagnosticLoopRun[]>;

  createDiagnosticLoopIteration(iteration: InsertDiagnosticLoopIteration): Promise<DiagnosticLoopIteration>;
  updateDiagnosticLoopIteration(id: number, patch: Partial<DiagnosticLoopIteration>): Promise<DiagnosticLoopIteration>;
  getDiagnosticLoopIterations(runId: string): Promise<DiagnosticLoopIteration[]>;

  // AI Chat Persistence
  getAiChatSessionByKey(sessionKey: string): Promise<AiChatSession | undefined>;
  getOrCreateAiChatSession(sessionKey: string, strategyPath: string | null, backtestId: number | null): Promise<AiChatSession>;
  clearAiChatSession(sessionId: number): Promise<AiChatSession>;
  createAiChatMessage(message: InsertAiChatMessage): Promise<AiChatMessage>;
  getAiChatMessages(sessionId: number, since?: Date | null): Promise<AiChatMessage[]>;
  createAiAuditEvent(event: InsertAiAuditEvent): Promise<AiAuditEvent>;
  // AI Actions
  createAiAction(action: InsertAiAction): Promise<AiAction>;
  getAiActions(sessionId?: number, backtestId?: number): Promise<AiAction[]>;
  getAiAction(id: number): Promise<AiAction | undefined>;
  getAiActionsForBacktest(backtestId: number): Promise<AiAction[]>;
  // Agent Handoffs
  createAgentHandoff(handoff: InsertAgentHandoff): Promise<AgentHandoff>;
  getAgentHandoffByRunId(runId: string): Promise<AgentHandoff | undefined>;
}

export class DatabaseStorage implements IStorage {
  private watchers: fsSync.FSWatcher[] = [];

  watchFilesystem(): void {
    const strategiesPath = "user_data/strategies";
    const configFile = "user_data/config.json";

    // Watch strategies directory
    try {
      const strategyWatcher = fsSync.watch(strategiesPath, { recursive: false }, async (eventType, filename) => {
        if (filename && filename.endsWith('.py')) {
          try {
            await this.syncWithFilesystem();
          } catch (err) {
            console.error("Error syncing after filesystem change:", err);
          }
        }
      });
      this.watchers.push(strategyWatcher);
      console.log(`[Storage] Watching strategies directory: ${strategiesPath}`);
    } catch (err) {
      console.warn(`[Storage] Could not watch ${strategiesPath}:`, err);
    }

    // Watch config file
    try {
      const configDir = path.dirname(configFile);
      const configWatcher = fsSync.watch(configDir, { recursive: false }, async (eventType, filename) => {
        if (filename === "config.json") {
          try {
            await this.syncWithFilesystem();
          } catch (err) {
            console.error("Error syncing after config change:", err);
          }
        }
      });
      this.watchers.push(configWatcher);
      console.log(`[Storage] Watching config file: ${configFile}`);
    } catch (err) {
      console.warn(`[Storage] Could not watch config file:`, err);
    }
  }

  stopWatching(): void {
    this.watchers.forEach(watcher => watcher.close());
    this.watchers = [];
  }

  async syncWithFilesystem(): Promise<void> {
    const strategiesPath = "user_data/strategies";
    const configFile = "user_data/config.json";

    // Sync strategies
    const strategyFiles = await glob(`${strategiesPath}/*.py`);
    for (const filePath of strategyFiles) {
      const content = await fs.readFile(filePath, "utf-8");
      const existing = await this.getFileByPath(filePath);
      if (existing) {
        if (existing.content !== content) {
          await this.updateFile(existing.id, content);
        }
      } else {
        await this.createFile({
          path: filePath,
          content,
          type: "python"
        });
      }
    }

    // Sync config.json
    if (await fs.access(configFile).then(() => true).catch(() => false)) {
      const configContent = await fs.readFile(configFile, "utf-8");
      const existingConfig = await this.getFileByPath(configFile);
      if (existingConfig) {
        if (existingConfig.content !== configContent) {
          await this.updateFile(existingConfig.id, configContent);
        }
      } else {
        await this.createFile({
          path: configFile,
          content: configContent,
          type: "json"
        });
      }
    }
  }

  async getFiles(): Promise<File[]> {
    return await db.select().from(filesTable).orderBy(desc(filesTable.lastModified));
  }

  async getFile(id: number): Promise<File | undefined> {
    const [file] = await db.select().from(filesTable).where(eq(filesTable.id, id));
    return file;
  }

  async getFileByPath(path: string): Promise<File | undefined> {
    const [file] = await db.select().from(filesTable).where(eq(filesTable.path, path));
    return file;
  }

  async createFile(insertFile: InsertFile): Promise<File> {
    const [file] = await db.insert(filesTable).values(insertFile).returning();
    
    // Write to FS if it doesn't exist or is different
    try {
      await fs.mkdir(path.dirname(insertFile.path), { recursive: true });
      await fs.writeFile(insertFile.path, insertFile.content);
    } catch (err) {
      console.error(`Failed to write file to FS: ${insertFile.path}`, err);
    }
    
    return file;
  }

  async updateFile(id: number, content: string): Promise<File> {
    const [updated] = await db.update(filesTable)
      .set({ content, lastModified: new Date() })
      .where(eq(filesTable.id, id))
      .returning();
    
    if (updated) {
      try {
        await fs.writeFile(updated.path, content);
      } catch (err) {
        console.error(`Failed to update file on FS: ${updated.path}`, err);
      }
    }
    
    return updated;
  }

  async deleteFile(id: number): Promise<void> {
    const file = await this.getFile(id);
    if (file) {
      try {
        await fs.unlink(file.path);
      } catch (err) {
        console.error(`Failed to delete file from FS: ${file.path}`, err);
      }
    }
    await db.delete(filesTable).where(eq(filesTable.id, id));
  }

  async getBacktests(): Promise<Backtest[]> {
    const rows = await db.select().from(backtests).orderBy(desc(backtests.createdAt));
    return rows.map((b) => ({ ...b, logs: [] } as Backtest));
  }

  async getBacktest(id: number): Promise<Backtest | undefined> {
    const maxEntries = 1000;
    const [backtest] = await db.select().from(backtests).where(eq(backtests.id, id));
    if (!backtest) return undefined;
    const logs = Array.isArray((backtest as any).logs) ? ((backtest as any).logs as string[]) : [];
    const trimmed = logs.length > maxEntries ? logs.slice(-maxEntries) : logs;
    return { ...backtest, logs: trimmed } as Backtest;
  }

  async createBacktest(insertBacktest: InsertBacktest): Promise<Backtest> {
    const [backtest] = await db.insert(backtests).values({
      ...insertBacktest,
      status: "running",
      logs: [],
    }).returning();
    return backtest;
  }

  async updateBacktestStatus(id: number, status: string, results?: any, logs?: string[]): Promise<Backtest> {
    const updates: any = { status };
    if (results) updates.results = results;
    
    // If logs are provided, we should set them directly as an array
    if (logs) updates.logs = Array.isArray(logs) ? logs : [String(logs)];
    
    const [updated] = await db.update(backtests)
      .set(updates)
      .where(eq(backtests.id, id))
      .returning();
    return updated;
  }

  async appendBacktestLog(id: number, logLine: string): Promise<void> {
    const maxEntries = 1000;

    await db.execute(sql`
      UPDATE backtests
      SET logs = (
        SELECT CASE
          WHEN COALESCE(array_length(next_logs, 1), 0) > ${maxEntries}
            THEN next_logs[(array_length(next_logs, 1) - ${maxEntries} + 1):array_length(next_logs, 1)]
          ELSE next_logs
        END
        FROM (
          SELECT array_append(COALESCE(backtests.logs, ARRAY[]::text[]), ${logLine}) AS next_logs
        ) t
      )
      WHERE id = ${id}
    `);
  }

  async createDiagnosticReport(report: InsertDiagnosticReport): Promise<DiagnosticReport> {
    const [inserted] = await db.insert(diagnosticReports).values(report).returning();
    return inserted;
  }

  async createDiagnosticChangeTargets(
    targets: InsertDiagnosticChangeTarget,
  ): Promise<DiagnosticChangeTarget | null> {
    try {
      const [inserted] = await db.insert(diagnosticChangeTargets).values(targets).returning();
      return inserted ?? null;
    } catch (err: any) {
      if (String(err?.code || "") === "42P01") return null;
      throw err;
    }
  }

  async getDiagnosticReport(id: number): Promise<DiagnosticReport | undefined> {
    const [report] = await db.select().from(diagnosticReports).where(eq(diagnosticReports.id, id));
    return report;
  }

  async getDiagnosticReportByReportId(reportId: string): Promise<DiagnosticReport | undefined> {
    const [report] = await db.select().from(diagnosticReports).where(eq(diagnosticReports.reportId, reportId));
    return report;
  }

  async getDiagnosticReports(backtestId?: number): Promise<DiagnosticReport[]> {
    if (backtestId) {
      return await db.select().from(diagnosticReports).where(eq(diagnosticReports.backtestId, backtestId)).orderBy(desc(diagnosticReports.createdAt));
    }
    return await db.select().from(diagnosticReports).orderBy(desc(diagnosticReports.createdAt));
  }

  async createDiagnosticJob(job: InsertDiagnosticJob): Promise<DiagnosticJob> {
    const [inserted] = await db.insert(diagnosticJobs).values(job).returning();
    return inserted;
  }

  async updateDiagnosticJob(id: string, patch: Partial<DiagnosticJob>): Promise<DiagnosticJob> {
    const [updated] = await db.update(diagnosticJobs)
      .set({
        ...patch,
        updatedAt: new Date(),
      } as any)
      .where(eq(diagnosticJobs.id, id))
      .returning();
    return updated;
  }

  async getDiagnosticJob(id: string): Promise<DiagnosticJob | undefined> {
    const [job] = await db.select().from(diagnosticJobs).where(eq(diagnosticJobs.id, id));
    return job;
  }

  async getDiagnosticJobs(backtestId?: number): Promise<DiagnosticJob[]> {
    if (backtestId) {
      return await db.select().from(diagnosticJobs).where(eq(diagnosticJobs.backtestId, backtestId)).orderBy(desc(diagnosticJobs.createdAt));
    }
    return await db.select().from(diagnosticJobs).orderBy(desc(diagnosticJobs.createdAt));
  }

  async createDiagnosticLoopRun(run: InsertDiagnosticLoopRun): Promise<DiagnosticLoopRun> {
    const [inserted] = await db.insert(diagnosticLoopRuns).values(run).returning();
    return inserted;
  }

  async updateDiagnosticLoopRun(id: string, patch: Partial<DiagnosticLoopRun>): Promise<DiagnosticLoopRun> {
    const [updated] = await db.update(diagnosticLoopRuns)
      .set({
        ...patch,
        updatedAt: new Date(),
      } as any)
      .where(eq(diagnosticLoopRuns.id, id))
      .returning();
    return updated;
  }

  async getDiagnosticLoopRun(id: string): Promise<DiagnosticLoopRun | undefined> {
    const [run] = await db.select().from(diagnosticLoopRuns).where(eq(diagnosticLoopRuns.id, id));
    return run;
  }

  async getDiagnosticLoopRuns(): Promise<DiagnosticLoopRun[]> {
    return await db.select().from(diagnosticLoopRuns).orderBy(desc(diagnosticLoopRuns.createdAt));
  }

  async createDiagnosticLoopIteration(iteration: InsertDiagnosticLoopIteration): Promise<DiagnosticLoopIteration> {
    const [inserted] = await db.insert(diagnosticLoopIterations).values(iteration as any).returning();
    return inserted;
  }

  async updateDiagnosticLoopIteration(id: number, patch: Partial<DiagnosticLoopIteration>): Promise<DiagnosticLoopIteration> {
    const [updated] = await db.update(diagnosticLoopIterations)
      .set({
        ...patch,
      } as any)
      .where(eq(diagnosticLoopIterations.id, id))
      .returning();
    return updated;
  }

  async getDiagnosticLoopIterations(runId: string): Promise<DiagnosticLoopIteration[]> {
    return await db
      .select()
      .from(diagnosticLoopIterations)
      .where(eq(diagnosticLoopIterations.runId, runId))
      .orderBy(asc(diagnosticLoopIterations.createdAt));
  }

  async getAiChatSessionByKey(sessionKey: string): Promise<AiChatSession | undefined> {
    const [session] = await db.select().from(aiChatSessions).where(eq(aiChatSessions.sessionKey, sessionKey));
    return session;
  }

  async getOrCreateAiChatSession(sessionKey: string, strategyPath: string | null, backtestId: number | null): Promise<AiChatSession> {
    const existing = await this.getAiChatSessionByKey(sessionKey);
    if (existing) {
      const shouldUpdate =
        (strategyPath && existing.strategyPath !== strategyPath) ||
        (backtestId != null && existing.backtestId !== backtestId);

      if (!shouldUpdate) return existing;

      const [updated] = await db.update(aiChatSessions)
        .set({
          strategyPath: strategyPath ?? existing.strategyPath,
          backtestId: backtestId ?? existing.backtestId,
          updatedAt: new Date(),
        })
        .where(eq(aiChatSessions.id, existing.id))
        .returning();
      return updated;
    }

    const [inserted] = await db.insert(aiChatSessions)
      .values({
        sessionKey,
        strategyPath: strategyPath ?? null,
        backtestId: backtestId ?? null,
      } as any)
      .returning();
    return inserted;
  }

  async clearAiChatSession(sessionId: number): Promise<AiChatSession> {
    const [updated] = await db.update(aiChatSessions)
      .set({ clearedAt: new Date(), updatedAt: new Date() })
      .where(eq(aiChatSessions.id, sessionId))
      .returning();
    return updated;
  }

  async createAiChatMessage(message: InsertAiChatMessage): Promise<AiChatMessage> {
    const [inserted] = await db.insert(aiChatMessages).values(message).returning();
    return inserted;
  }

  async getAiChatMessages(sessionId: number, since?: Date | null): Promise<AiChatMessage[]> {
  const whereClause = since
    ? and(eq(aiChatMessages.sessionId, sessionId), gt(aiChatMessages.createdAt, since as any))
    : eq(aiChatMessages.sessionId, sessionId);

  return await db
    .select()
    .from(aiChatMessages)
    .where(whereClause)
    .orderBy(asc(aiChatMessages.createdAt));
}

  async createAiAuditEvent(event: InsertAiAuditEvent): Promise<AiAuditEvent> {
    const [inserted] = await db.insert(aiAuditEvents).values(event).returning();
    return inserted;
  }

  async createAiAction(action: InsertAiAction): Promise<AiAction> {
    try {
      const [inserted] = await db.insert(aiActions).values(action).returning();
      return inserted;
    } catch (err: any) {
      // If migrations haven't been applied yet, avoid crashing the whole request path.
      if (String(err?.code || "") === "42P01") {
        throw new Error("ai_actions table is missing. Apply migrations (db:push) and retry.");
      }
      throw err;
    }
  }

  async getAiActions(sessionId?: number, backtestId?: number): Promise<AiAction[]> {
    try {
      if (sessionId && backtestId) {
        return await db
          .select()
          .from(aiActions)
          .where(and(eq(aiActions.sessionId, sessionId), eq(aiActions.backtestId, backtestId)))
          .orderBy(desc(aiActions.createdAt));
      }
      if (sessionId) {
        return await db.select().from(aiActions).where(eq(aiActions.sessionId, sessionId)).orderBy(desc(aiActions.createdAt));
      }
      if (backtestId) {
        return await db.select().from(aiActions).where(eq(aiActions.backtestId, backtestId)).orderBy(desc(aiActions.createdAt));
      }
      return await db.select().from(aiActions).orderBy(desc(aiActions.createdAt));
    } catch (err: any) {
      if (String(err?.code || "") === "42P01") return [];
      throw err;
    }
  }

  async getAiAction(id: number): Promise<AiAction | undefined> {
    try {
      const [action] = await db.select().from(aiActions).where(eq(aiActions.id, id));
      return action;
    } catch (err: any) {
      if (String(err?.code || "") === "42P01") return undefined;
      throw err;
    }
  }

  async getAiActionsForBacktest(backtestId: number): Promise<AiAction[]> {
    try {
      return await db.select().from(aiActions).where(eq(aiActions.backtestId, backtestId)).orderBy(desc(aiActions.createdAt));
    } catch (err: any) {
      if (String(err?.code || "") === "42P01") return [];
      throw err;
    }
  }

  async createAgentHandoff(handoff: InsertAgentHandoff): Promise<AgentHandoff> {
    const [inserted] = await db.insert(agentHandoffs).values(handoff).returning();
    return inserted;
  }

  async getAgentHandoffByRunId(runId: string): Promise<AgentHandoff | undefined> {
    try {
      const [handoff] = await db.select().from(agentHandoffs).where(eq(agentHandoffs.runId, runId));
      return handoff;
    } catch (err: any) {
      if (String(err?.code || "") === "42P01") return undefined;
      throw err;
    }
  }
}

export const storage = new DatabaseStorage();
