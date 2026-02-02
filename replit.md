# FreqTrade IDE

## Overview

A comprehensive web-based development environment for FreqTrade cryptocurrency trading strategy development. The application combines a full-featured code editor, AI-powered assistance via OpenRouter, and integrated backtesting capabilities for trading strategies. Users can write Python trading strategies, run backtests against historical data, and visualize results—all within a browser-based IDE.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter (lightweight React router)
- **State Management**: TanStack Query for server state, Zustand for local/persistent state (AI settings)
- **UI Components**: shadcn/ui component library built on Radix UI primitives
- **Styling**: Tailwind CSS with custom dark IDE theme (VS Code inspired)
- **Code Editor**: Monaco Editor (@monaco-editor/react) for Python/JSON editing
- **Data Visualization**: Recharts for backtest results and equity curves

### Backend Architecture
- **Runtime**: Node.js with Express
- **Language**: TypeScript with ESM modules
- **Build Tool**: Vite for frontend, esbuild for server bundling
- **API Design**: RESTful endpoints with Zod validation schemas defined in shared/routes.ts

### Data Storage
- **Database**: PostgreSQL via Drizzle ORM
- **Schema Location**: shared/schema.ts
- **Tables**: 
  - `files` - Virtual filesystem for strategy files (path, content, type)
  - `backtests` - Backtest configurations and results (strategy, config, status, logs, results)

### Key Design Patterns
- **Shared Types**: TypeScript types and Zod schemas shared between frontend/backend via `@shared/*` path alias
- **API Contract**: Route definitions in shared/routes.ts provide type-safe API contracts
- **Storage Interface**: IStorage interface in server/storage.ts abstracts database operations
- **Component Structure**: Feature components in client/src/components, UI primitives in client/src/components/ui

### Project Structure
```
client/src/
  components/     # Feature components (Editor, Sidebar, ChatPanel, etc.)
  components/ui/  # shadcn/ui primitives
  hooks/          # React Query hooks for API calls
  pages/          # Page components
  lib/            # Utilities and query client setup

server/
  index.ts        # Express server entry
  routes.ts       # API route handlers
  storage.ts      # Database operations
  db.ts           # Drizzle/PostgreSQL connection

shared/
  schema.ts       # Drizzle schema + Zod types
  routes.ts       # API route definitions

user_data/        # FreqTrade configuration and strategies
  strategies/     # Python trading strategy files
  config.json     # FreqTrade configuration
```

## External Dependencies

### Database
- **PostgreSQL**: Primary data store, connection via DATABASE_URL environment variable
- **Drizzle ORM**: Schema management and query building
- **drizzle-kit**: Database migrations (`npm run db:push`)

### AI Integration
- **OpenRouter API**: AI chat functionality using free models (Gemma, Llama, etc.)
- API key stored in browser localStorage via Zustand persist middleware
- Models fetched from /api/ai/models endpoint

### FreqTrade Integration
- Python FreqTrade framework for backtesting execution
- Strategy files stored in user_data/strategies/
- Backtest results stored in user_data/backtest_results/
- Configuration in user_data/config.json

### Frontend Libraries
- Monaco Editor for code editing
- Recharts for data visualization
- Framer Motion for animations
- date-fns for date formatting

### Build & Development
- Vite with React plugin for frontend development
- esbuild for production server bundling
- TypeScript with strict mode enabled