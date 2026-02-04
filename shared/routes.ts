import { z } from 'zod';
import {
  insertFileSchema,
  runBacktestRequestSchema,
  files,
  backtests,
  aiChatSessions,
  aiChatMessages,
  aiActions,
  agentHandoffs,
} from './schema';

export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  notFound: z.object({
    message: z.string(),
  }),
  internal: z.object({
    message: z.string(),
  }),
};

export const api = {
  files: {
    list: {
      method: 'GET' as const,
      path: '/api/files',
      responses: {
        200: z.array(z.custom<typeof files.$inferSelect>()),
      },
    },
    getByPath: {
      method: 'GET' as const,
      path: '/api/files/by-path',
      responses: {
        200: z.custom<typeof files.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    get: {
      method: 'GET' as const,
      path: '/api/files/:id',
      responses: {
        200: z.custom<typeof files.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/files',
      input: insertFileSchema,
      responses: {
        201: z.custom<typeof files.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    update: {
      method: 'PUT' as const,
      path: '/api/files/:id',
      input: z.object({ content: z.string() }),
      responses: {
        200: z.custom<typeof files.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/files/:id',
      responses: {
        204: z.void(),
        404: errorSchemas.notFound,
      },
    },
  },
  backtests: {
    list: {
      method: 'GET' as const,
      path: '/api/backtests',
      responses: {
        200: z.array(z.custom<typeof backtests.$inferSelect>()),
      },
    },
    run: {
      method: 'POST' as const,
      path: '/api/backtests/run',
      input: runBacktestRequestSchema,
      responses: {
        201: z.custom<typeof backtests.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    get: {
      method: 'GET' as const,
      path: '/api/backtests/:id',
      responses: {
        200: z.custom<typeof backtests.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    batchRun: {
      method: 'POST' as const,
      path: '/api/backtests/batch-run',
      input: z.object({
        strategyName: z.string(),
        baseConfig: z.any(),
        ranges: z.array(z.object({
          from: z.string(),
          to: z.string(),
        })).optional(),
        rolling: z.object({
          windowDays: z.number(),
          stepDays: z.number().optional(),
          count: z.number().optional(),
          end: z.string().optional(),
        }).optional(),
        batchId: z.string().optional(),
      }),
      responses: {
        201: z.object({
          batchId: z.string(),
          backtests: z.array(z.custom<typeof backtests.$inferSelect>()),
        }),
        400: errorSchemas.validation,
      },
    },
  },
  strategies: {
    edit: {
      method: 'POST' as const,
      path: '/api/strategies/edit',
      input: (() => {
        const strategyEditTargetSchema = z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("function"), name: z.string() }),
          z.object({ kind: z.literal("class"), name: z.string() }),
          z.object({ kind: z.literal("param"), name: z.string() }),
          z.object({
            kind: z.literal("range"),
            startLine: z.number().int().min(1),
            endLine: z.number().int().min(1),
          }),
        ]);
        const strategyEditAnchorSchema = z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("after_function"), name: z.string() }),
          z.object({ kind: z.literal("class_end"), name: z.string().optional() }),
          z.object({ kind: z.literal("module_end") }),
          z.object({ kind: z.literal("heuristic_indicators") }),
        ]);
        const strategyEditReplaceSchema = z.object({
          kind: z.literal("replace"),
          target: strategyEditTargetSchema,
          before: z.string(),
          after: z.string(),
        });
        const strategyEditInsertSchema = z.object({
          kind: z.literal("insert"),
          anchor: strategyEditAnchorSchema,
          content: z.string(),
        });
        const strategyEditSchema = z.union([strategyEditReplaceSchema, strategyEditInsertSchema]);
        return z.object({
          strategyPath: z.string(),
          edits: z.array(strategyEditSchema),
          dryRun: z.boolean().optional(),
        });
      })(),
      responses: {
        200: z
          .object({
            success: z.boolean().optional(),
            dryRun: z.boolean().optional(),
            diff: z.string().optional(),
            content: z.string().optional(),
            applied: z.array(z.any()).optional(),
          })
          .passthrough(),
        400: errorSchemas.validation,
        500: errorSchemas.internal,
      },
    },
    params: {
      method: 'POST' as const,
      path: '/api/strategies/params',
      input: z.object({
        strategyPath: z.string(),
      }),
      responses: {
        200: z.object({
          params: z.array(z.object({
            name: z.string(),
            type: z.string(),
            line: z.number(),
            endLine: z.number(),
            args: z.array(z.any()),
            default: z.any(),
            space: z.any(),
            optimize: z.any(),
            before: z.string(),
          })),
        }),
        400: errorSchemas.validation,
        500: errorSchemas.internal,
      },
    },
    applyParams: {
      method: 'POST' as const,
      path: '/api/strategies/params/apply',
      input: z.object({
        strategyPath: z.string(),
        changes: z.array(z.object({
          name: z.string(),
          before: z.string(),
          after: z.string(),
        })),
      }),
      responses: {
        200: z.object({
          success: z.boolean().optional(),
        }).passthrough(),
        400: errorSchemas.validation,
        500: errorSchemas.internal,
      },
    },
  },
  ai: {
    models: {
      method: 'GET' as const,
      path: '/api/ai/models',
      responses: {
        200: z.array(z.object({
          id: z.string(),
          name: z.string(),
          description: z.string().optional(),
        })),
      },
    },
    test: {
      method: 'POST' as const,
      path: '/api/ai/test',
      input: z.object({
        model: z.string(),
      }),
      responses: {
        200: z.object({
          success: z.boolean(),
          model: z.string(),
          response: z.string().optional(),
        }),
        400: errorSchemas.validation,
        500: errorSchemas.internal,
      },
    },
    chat: {
      method: 'POST' as const,
      path: '/api/ai/chat',
      input: z.object({
        message: z.string(),
        model: z.string(),
        context: z.object({
          fileName: z.string().optional(),
          fileContent: z.string().optional(),
          selectedCode: z.string().optional(),
          lineNumber: z.number().optional(),
          cursorFunctionName: z.string().optional(),
          lastBacktest: z.object({
            id: z.number().optional(),
            strategyName: z.string().optional(),
            config: z.any().optional(),
          }).optional(),
          backtestResults: z.object({
            profit_total: z.number(),
            win_rate: z.number(),
            max_drawdown: z.number(),
            total_trades: z.number(),
            avg_profit: z.number().optional(),
            sharpe: z.number().optional(),
          }).optional(),
        }).optional(),
      }),
      responses: {
        200: z.object({
          response: z.string(),
        }),
        400: errorSchemas.validation,
        500: errorSchemas.internal,
      },
    },
  },
  diagnostics: {
    analyze: {
      method: 'POST' as const,
      path: '/api/diagnostic/analyze',
      input: z.object({
        backtestId: z.number(),
        strategyPath: z.string().optional(),
      }),
      responses: {
        202: z.object({ jobId: z.string(), status: z.string() }),
        400: errorSchemas.validation,
        500: errorSchemas.internal,
      },
    },
    job: {
      method: 'GET' as const,
      path: '/api/diagnostic/jobs/:jobId',
      responses: {
        200: z.any(),
        404: errorSchemas.notFound,
      },
    },
    jobResult: {
      method: 'GET' as const,
      path: '/api/diagnostic/jobs/:jobId/result',
      responses: {
        200: z.any(),
        404: errorSchemas.notFound,
      },
    },
    jobs: {
      method: 'GET' as const,
      path: '/api/diagnostic/jobs',
      responses: {
        200: z.array(z.any()),
      },
    },
    reports: {
      method: 'GET' as const,
      path: '/api/diagnostic/reports',
      responses: {
        200: z.array(z.any()),
      },
    },
  },
  diagnosticLoop: {
    start: {
      method: 'POST' as const,
      path: '/api/diagnostic-loop/start',
      input: z.object({
        strategyPath: z.string(),
        baseConfig: z.any(),
        timerange: z.string().optional(),
        pairs: z.array(z.string()).optional(),
        maxIterations: z.number().int().min(1).max(3).optional(),
        drawdownCap: z.number().min(0).max(1).optional(),
      }),
      responses: {
        202: z.object({ runId: z.string(), status: z.string() }),
        400: errorSchemas.validation,
        500: errorSchemas.internal,
      },
    },
    run: {
      method: 'GET' as const,
      path: '/api/diagnostic-loop/runs/:runId',
      responses: {
        200: z.any(),
        404: errorSchemas.notFound,
      },
    },
    runs: {
      method: 'GET' as const,
      path: '/api/diagnostic-loop/runs',
      responses: {
        200: z.array(z.any()),
      },
    },
    stop: {
      method: 'POST' as const,
      path: '/api/diagnostic-loop/runs/:runId/stop',
      responses: {
        200: z.object({ success: z.boolean() }).passthrough(),
        404: errorSchemas.notFound,
      },
    },
    report: {
      method: 'GET' as const,
      path: '/api/diagnostic-loop/runs/:runId/report',
      responses: {
        200: z.any(),
        404: errorSchemas.notFound,
      },
    },
  },
  chat: {
    sessions: {
      method: 'GET' as const,
      path: '/api/chat/sessions',
      responses: {
        200: z.array(z.custom<typeof aiChatSessions.$inferSelect>()),
      },
    },
    createSession: {
      method: 'POST' as const,
      path: '/api/chat/sessions',
      input: z.object({
        sessionKey: z.string(),
        strategyPath: z.string().optional(),
        backtestId: z.number().optional(),
      }),
      responses: {
        201: z.custom<typeof aiChatSessions.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    messages: {
      method: 'GET' as const,
      path: '/api/chat/sessions/:id/messages',
      responses: {
        200: z.array(z.custom<typeof aiChatMessages.$inferSelect>()),
      },
    },
    createMessage: {
      method: 'POST' as const,
      path: '/api/chat/sessions/:id/messages',
      input: z.object({
        role: z.string(),
        content: z.string(),
        model: z.string().optional(),
        request: z.any().optional(),
        response: z.any().optional(),
      }),
      responses: {
        201: z.custom<typeof aiChatMessages.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
  },
  aiActions: {
    list: {
      method: 'GET' as const,
      path: '/api/ai-actions',
      responses: {
        200: z.array(z.custom<typeof aiActions.$inferSelect>()),
      },
    },
    get: {
      method: 'GET' as const,
      path: '/api/ai-actions/:id',
      responses: {
        200: z.custom<typeof aiActions.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/ai-actions',
      input: z.object({
        sessionId: z.number().optional(),
        messageId: z.number().optional(),
        actionType: z.string(),
        description: z.string(),
        beforeState: z.any().optional(),
        afterState: z.any().optional(),
        diff: z.any().optional(),
        backtestId: z.number().optional(),
        diagnosticReportId: z.number().optional(),
        results: z.any().optional(),
      }),
      responses: {
        201: z.custom<typeof aiActions.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    byBacktest: {
      method: 'GET' as const,
      path: '/api/backtests/:id/ai-actions',
      responses: {
        200: z.array(z.custom<typeof aiActions.$inferSelect>()),
      },
    },
  },
  agentHandoff: {
    create: {
      method: 'POST' as const,
      path: '/api/agent-handoff',
      input: z.object({
        runId: z.string(),
        agentId: z.string(),
        envelope: z.any(),
      }),
      responses: {
        201: z.custom<typeof agentHandoffs.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    get: {
      method: 'GET' as const,
      path: '/api/agent-handoff/:runId',
      responses: {
        200: z.custom<typeof agentHandoffs.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
  },
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}
