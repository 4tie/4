import { z } from 'zod';
import { insertFileSchema, runBacktestRequestSchema, files, backtests } from './schema';

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
  }
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
