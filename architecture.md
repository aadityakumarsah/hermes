# Hermes / Clawbot Agent — Architecture Document

> **Version**: 1.0.0
> **Status**: Design Phase
> **Date**: 2026-09-15

---

## Table of Contents

1. [Repository Analysis](#1-repository-analysis)
2. [What We Can Reuse](#2-what-we-can-reuse)
3. [What Must Be Replaced or Extended](#3-what-must-be-replaced-or-extended)
4. [Target Architecture](#4-target-architecture)
5. [Component Responsibilities](#5-component-responsibilities)
6. [Data-Flow Diagrams](#6-data-flow-diagrams)
7. [Technology Decisions](#7-technology-decisions)
8. [Proposed Directory Structure](#8-proposed-directory-structure)
9. [Implementation Roadmap](#9-implementation-roadmap)

---

## 1. Repository Analysis

### 1.1 OpenClaw — Overview

OpenClaw is a multi-channel AI gateway that runs as a personal or team assistant. It is a **pnpm monorepo** written in **TypeScript (ESM)** targeting **Node.js 24.16+ / 26+**. The project ships as an npm package (`openclaw`) with a CLI binary, a local Gateway server, a Control UI, and bundled channel/provider plugins.

### 1.2 Top-Level Directory Map

```
openclaw/
├── src/                    # Core runtime (120+ modules)
│   ├── agents/             # Agent loop, tool assembly, harness
│   ├── channels/           # Channel registry, message pipeline, ingress
│   ├── chat/               # Chat message types, sender identity
│   ├── config/             # Configuration schema, defaults, validation
│   ├── context-engine/     # Context assembly/compaction engines
│   ├── cron/               # Cron scheduler, job lifecycle, delivery
│   ├── gateway/            # WebSocket/HTTP server, auth, RPC, streaming
│   ├── hooks/              # Lifecycle hooks
│   ├── llm/                # LLM runtime binding, provider wiring
│   ├── memory/             # Root memory files, memory host SDK bridge
│   ├── plugins/            # Plugin loader, tool assembly, SDK boundary
│   ├── plugin-sdk/         # Public SDK contracts (channels, tools, agents)
│   ├── sessions/           # Session ID, lifecycle admission, conversation turns
│   ├── state/              # SQLite state DB, agent DBs, migrations
│   ├── tasks/              # Task flows, executor, detached task runtime
│   └── ...                 # 100+ more modules
├── extensions/             # 160+ bundled plugin packages
│   ├── slack/              # Slack channel (Bolt, Socket/HTTP modes)
│   ├── whatsapp/           # WhatsApp channel (Baileys WebSocket)
│   ├── discord/            # Discord channel
│   ├── telegram/           # Telegram channel
│   ├── openai/             # OpenAI provider
│   ├── anthropic/          # Anthropic provider
│   ├── memory-core/        # Memory plugin (consolidation, tools)
│   ├── memory-lancedb/     # Vector storage via LanceDB
│   └── ...                 # 150+ more extensions
├── packages/               # 23 private shared packages
│   ├── agent-core/         # Agent loop, types, validation
│   ├── ai/                 # LLM runtime, provider registry, streaming
│   ├── llm-core/           # LLM contracts (types, events, streams)
│   ├── memory-host-sdk/    # Memory host SDK namespaces
│   ├── plugin-sdk/         # Re-export facade for plugin SDK
│   ├── gateway-protocol/   # Gateway RPC protocol types
│   └── ...
├── ui/                     # Control UI (Vite + Lit)
├── apps/                   # Native apps (macOS, iOS, Android, Linux Tauri)
├── docs/                   # Documentation
├── skills/                 # Bundled skills
└── test/                   # Fixtures and test infrastructure
```

### 1.3 Architecture Layers

```
┌─────────────────────────────────────────────────────────┐
│                    Native Apps / CLI / TUI               │
├─────────────────────────────────────────────────────────┤
│                    Control UI (Vite + Lit)               │
├─────────────────────────────────────────────────────────┤
│                     Gateway Server                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐ │
│  │ WebSocket │  │ HTTP RPC │  │  SSE     │  │ WebPush│ │
│  └──────────┘  └──────────┘  └──────────┘  └────────┘ │
├─────────────────────────────────────────────────────────┤
│                   Channel Layer                          │
│  ┌──────┐ ┌──────────┐ ┌────────┐ ┌───────┐ ┌───────┐│
│  │ Slack │ │ WhatsApp │ │Discord │ │Telegram│ │ 20+   ││
│  └──────┘ └──────────┘ └────────┘ └───────┘ └───────┘│
├─────────────────────────────────────────────────────────┤
│                  Agent Orchestration                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐             │
│  │Agent Loop │  │  Tools   │  │ Context  │             │
│  │ (stream)  │  │ Assembly │  │  Engine  │             │
│  └──────────┘  └──────────┘  └──────────┘             │
├─────────────────────────────────────────────────────────┤
│               LLM Transport Layer                       │
│  ┌────────┐ ┌──────────┐ ┌────────┐ ┌──────────────┐ │
│  │OpenAI  │ │Anthropic │ │ Google │ │ 30+ providers│ │
│  └────────┘ └──────────┘ └────────┘ └──────────────┘ │
├─────────────────────────────────────────────────────────┤
│              Storage: SQLite (via Kysely)                │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐             │
│  │ State DB  │  │ Agent DB │  │Memory DB │             │
│  └──────────┘  └──────────┘  └──────────┘             │
└─────────────────────────────────────────────────────────┘
```

### 1.4 Key Subsystems — Detailed Findings

#### A. Agent System

**Location**: `packages/agent-core/` (contracts) + `src/agents/` (runtime)

- **Agent Loop** (`packages/agent-core/src/agent-loop.ts`): Streaming event loop that processes LLM responses, resolves tool calls, validates arguments, executes tools (sequential or parallel), and produces `ExecutedToolCallBatch` results.
- **StreamFn Contract**: Must never throw. Failures encoded as events + terminal message with `stopReason: "error" | "aborted"`.
- **Tool Execution**: `resolveToolCallTool` → `prepareToolCall` → `prepareToolCallArguments` → `validateToolCallForBatchAdmission` → parallel execution with `queueMicrotask` chaining.
- **Agent Harness** (`src/agents/harness/`): Pluggable agent harness system for Codex and other agent backends.
- **Queue Modes**: `"all"` (process everything) or `"one-at-a-time"` (serialized).
- **Event Streaming**: `AssistantMessageEventStream` flows through `streamAgentResponse` → `AgentEventSink` → task/cron progress.

#### B. Channel Abstraction

**Location**: `src/channels/plugins/` (contract) + `extensions/*/` (implementations)

- **ChannelPlugin Type** (`src/channels/plugins/types.plugin.ts`): 30+ adapter slots including `config`, `pairing`, `security`, `groups`, `mentions`, `outbound`, `status`, `gateway`, `auth`, `approvalCapability`, `commands`, `lifecycle`, `secrets`, `allowlist`, `doctor`, `threading`, `message`, `actions`, `heartbeat`, `agentTools`, `reload`.
- **defineBundledChannelEntry**: The standard entry point pattern — declares `plugin`, `runtime`, `secrets`, `registerFull`.
- **Message Pipeline** (`src/channels/message/`): Ingress queue → drain → adapter → reply pipeline → outbound bridge.
- **Threading**: `ChannelThreadingAdapter` with `replyToMode`, `isThreadReply`, `replyToId`.
- **Pairing/Security**: `ChannelPairingAdapter`, `ChannelSecurityAdapter`, `ChannelAllowlistAdapter`.

#### C. Memory System

**Location**: `extensions/memory-core/` + `extensions/memory-lancedb/` + `packages/memory-host-sdk/`

- **Memory as Plugin**: Only one memory plugin active at a time (per VISION.md).
- **memory-core Tools**: `intent`, `memory_get`, `memory_search`.
- **"Dreaming" Consolidation**: Cron job (`0 3 * * *`) using `anthropic/claude-sonnet-4-6` to consolidate memories.
- **LanceDB Vector Store**: Arrow schema with agent-scoped predicates for semantic search.
- **Host SDK**: 10+ namespaces covering runtime, engine, storage, embeddings, sessions, queries, secrets, status.

#### D. Tool System

**Location**: `src/plugins/tools.ts` (assembly) + `src/agents/agent-tools.ts` (policy)

- **Tool Assembly**: Core tools + shell tools + channel tools + OpenClaw tools + plugin tools + tool-search tools.
- **Tool Profiles**: `minimal`, `coding`, `messaging`, `full`.
- **Tool Policy**: Allowlist/denylist via glob matching, sandbox policy, provider policy, sender policy, group policy.
- **Approval System**: Two-phase exec approval via Gateway RPC (`exec.approval.requested/resolved`).
- **AgentTool Contract**: `{ name, parameters (JSON Schema), exec, includeInContext, beforeToolCall, ... }`.

#### E. Session Management

**Location**: `src/sessions/`

- **Session ID**: UUID-shaped, with `SESSION_ID_RE` validation.
- **Lifecycle Admission**: Serializes lifecycle mutations and work admission per logical session using `AsyncLocalStorage`, store-writer queues, global states.
- **Conversation Turns**: Pending-turn registry keyed by `[agentId, id]`.
- **Work Admission**: Handoff/lease system for Gateway ↔ subordinate runs with drain timeout (15s).

#### F. Plugin Architecture

**Location**: `src/plugins/` + `src/plugin-sdk/`

- **Manifest-First Loading**: Plugins declare manifest → loader discovers → lazy activation.
- **SDK Boundary**: `openclaw/plugin-sdk/*` exports; extensions never import `src/**`.
- **Lazy Runtime Modules**: `createLazyRuntimeModule` for on-demand code loading.
- **Two Plugin Styles**: Code plugins (runtime hooks, providers, channels, tools) vs. Bundle plugins (skills, MCP servers, config).

#### G. Gateway

**Location**: `src/gateway/`

- **Server**: WebSocket + HTTP + SSE transport.
- **Auth**: Session tokens, pairing, device identity.
- **RPC Methods**: `chat.send`, `exec.approval.*`, `web.login.*`, etc.
- **Streaming**: SSE-based chat streaming with backpressure, drain tokens.
- **State DB**: Central SQLite via `openOpenClawStateDatabase`.

#### H. Storage

**Location**: `src/state/`

- **SQLite-First**: `node:sqlite` `DatabaseSync` driver, Kysely ORM.
- **Synchronous Write Transactions**: No `await` inside transaction callbacks.
- **Schema Versioning**: `OPENCLAW_STATE_SCHEMA_VERSION`, migration system.
- **Agent DBs**: Per-agent SQLite databases with symlink-loop detection, path hardening.

#### I. Configuration

**Location**: `src/config/`

- **OpenClawConfig**: Sections for `auth`, `accessGroups`, `agents`, `approvals`, `audit`, `browser`, `channels`, `cron`, `gateway`, `hooks`, `logging`, `mcp`, `memory`, `models`, `plugins`, `secrets`, `sessions`, `skills`, `telemetry`, `tools`, `tts`, etc.
- **Doctor/Migration**: `openclaw doctor --fix` detects old shapes and rewrites.

#### J. Cron / Background Tasks

**Location**: `src/cron/` + `src/tasks/`

- **CronService**: Stateful scheduler with start/stop/pause/resume.
- **Task Flows**: Multi-step managed tasks with SQLite-backed stores.
- **Task Executor**: `createQueuedTaskRunCore` → auto-wraps detached runs into flows.
- **Run Receipts**: Outcome recording, timer events, post-persist notifications.

---

## 2. What We Can Reuse

These OpenClaw subsystems are production-quality and directly reusable:

| Subsystem | Path | Why Reuse |
|---|---|---|
| **Agent Loop** | `packages/agent-core/` | Well-tested streaming loop with tool execution, error handling, compaction |
| **LLM Transport** | `packages/ai/` | Provider-agnostic registry, 30+ providers, streaming, auth |
| **Channel Plugin Contract** | `src/channels/plugins/` | Mature abstraction with 30+ adapter slots |
| **Slack Extension** | `extensions/slack/` | Production Bolt integration, Socket/HTTP modes, threads, streaming |
| **WhatsApp Extension** | `extensions/whatsapp/` | Baileys multi-device, QR auth, media handling |
| **Plugin SDK** | `src/plugin-sdk/` | Comprehensive plugin boundary, lazy loading, manifest system |
| **Tool Assembly** | `src/plugins/tools.ts` | Policy-driven tool surface construction |
| **Session Lifecycle** | `src/sessions/` | Admission control, identity normalization, work leases |
| **Configuration Schema** | `src/config/` | Rich config types with doctor/migration system |
| **Cron Infrastructure** | `src/cron/` | Stateful scheduler with receipt tracking |
| **Gateway Server** | `src/gateway/` | WebSocket/HTTP/SSE transport layer |
| **Context Engine** | `src/context-engine/` | Pluggable context assembly with compaction delegation |
| **Tool Approval** | `src/agents/*.before-tool-call.*` | Two-phase approval system |

---

## 3. What Must Be Replaced or Extended

| Area | Current State | Required Change | Reason |
|---|---|---|---|
| **Primary Storage** | SQLite (single-process) | PostgreSQL | Multi-process, concurrent access, production durability |
| **Cache/Pub-Sub** | In-process state | Redis | Cross-process state, pub/sub for event bus, rate limiting |
| **Vector Storage** | LanceDB (embedded) | pgvector / Qdrant | Production-grade vector search, horizontal scaling |
| **Event Bus** | In-process streams | Redis Streams / NATS | Cross-service event propagation, decoupled architecture |
| **Background Jobs** | In-process cron + tasks | Dedicated job queue (BullMQ) | Reliable background processing, retries, distributed workers |
| **Authentication** | Session tokens + pairing | JWT + API keys + RBAC | Multi-tenant, API access, programmatic auth |
| **Observability** | Basic logging | Structured logging + tracing + metrics | Production debugging, performance monitoring |
| **Web Chat** | Gateway-native (Control UI) | Dedicated web channel plugin | Customizable, embeddable, multi-tenant |
| **Memory** | Single-plugin slot | Multi-tier memory system | Long-term + working + episodic memory layers |
| **Workflow Engine** | Basic task flows | DAG-based workflow engine | Complex multi-step automations |
| **Agent State** | SQLite session state | Redis + PostgreSQL | Fast access + durable persistence |
| **Multi-Tenancy** | Single-user/team model | Full tenant isolation | SaaS deployment model |

---

## 4. Target Architecture

### 4.1 High-Level Architecture

```
                            ┌──────────────────┐
                            │      User        │
                            └────────┬─────────┘
                                     │
                    ┌────────────────┼────────────────┐
                    │                │                 │
               ┌────▼────┐    ┌─────▼─────┐    ┌─────▼─────┐
               │   Web    │    │   Slack   │    │ WhatsApp  │
               │  Chat    │    │           │    │           │
               └────┬─────┘    └─────┬─────┘    └─────┬─────┘
                    │                │                 │
                    └────────────────┼─────────────────┘
                                     │
                          ┌──────────▼──────────┐
                          │   Message Gateway   │
                          │  (Protocol Adapter) │
                          └──────────┬──────────┘
                                     │
                    ┌────────────────┼────────────────┐
                    │                │                 │
          ┌─────────▼──────┐ ┌──────▼───────┐ ┌──────▼──────┐
          │  Conversation  │ │    Auth      │ │  Tenant     │
          │  / Session Mgr │ │  Service     │ │  Service    │
          └─────────┬──────┘ └──────────────┘ └─────────────┘
                    │
          ┌─────────▼──────────────────────────────────┐
          │          Agent Orchestrator                  │
          │                                             │
          │  ┌───────┐ ┌──────┐ ┌──────┐ ┌──────────┐ │
          │  │  LLM  │ │Memory│ │Tools │ │ Planner  │ │
          │  │Router │ │Engine│ │      │ │          │ │
          │  └───┬───┘ └──┬───┘ └──┬───┘ └──────────┘ │
          │      │        │        │                    │
          │  ┌───▼────────▼────────▼──────────────────┐ │
          │  │        Workflow Engine                   │ │
          │  │  (DAG scheduler + state machine)        │ │
          │  └────────────────────────────────────────┘ │
          └─────────────────┬──────────────────────────┘
                            │
          ┌─────────────────┼──────────────────────────┐
          │                 │                           │
  ┌───────▼──────┐  ┌──────▼──────┐  ┌───────────────▼──┐
  │ Synchronous  │  │ Background  │  │   Scheduled      │
  │   Tools      │  │   Jobs      │  │   Tasks          │
  │              │  │ (BullMQ)    │  │   (Cron + BullMQ)│
  └──────────────┘  └─────────────┘  └──────────────────┘
                            │
          ┌─────────────────┼──────────────────────────┐
          │                 │                           │
  ┌───────▼──────┐  ┌──────▼──────┐  ┌───────────────▼──┐
  │ PostgreSQL   │  │    Redis    │  │  Vector Store    │
  │ (primary)    │  │  (cache +   │  │  (pgvector /     │
  │              │  │   pub/sub)  │  │   Qdrant)        │
  └──────────────┘  └─────────────┘  └──────────────────┘
```

### 4.2 Layer Breakdown

#### Layer 1: Channel Adapters
Responsible for protocol translation. Each adapter normalizes inbound messages to a canonical `InboundMessage` type and renders outbound `OutboundMessage` to platform format.

#### Layer 2: Message Gateway
The central ingress/egress point. Routes messages to conversation manager, handles deduplication, rate limiting, and multi-tenant dispatch.

#### Layer 3: Conversation / Session Manager
Manages conversation lifecycle, session state, message history, and cross-channel identity resolution.

#### Layer 4: Agent Orchestrator
The brain. Routes requests through LLM, manages memory context, dispatches tools, and coordinates multi-step workflows.

#### Layer 5: Execution Layer
Handles synchronous tool execution, background job processing, and scheduled task management.

#### Layer 6: Storage
Persistent data layer with PostgreSQL (primary), Redis (cache/events), and vector store (embeddings).

---

## 5. Component Responsibilities

### 5.1 Channel Adapters

| Component | Responsibility |
|---|---|
| `SlackAdapter` | Slack Bolt integration, Socket/HTTP modes, thread management, Block Kit rendering |
| `WhatsAppAdapter` | Baileys WebSocket, QR auth, media handling, group support |
| `WebChatAdapter` | WebSocket-based real-time chat, SSE streaming, REST API |
| `ChannelRegistry` | Discovery, lifecycle management, health checks for all adapters |
| `MessageNormalizer` | Platform-specific → canonical message conversion |
| `MessageRenderer` | Canonical → platform-specific output formatting |

### 5.2 Message Gateway

| Component | Responsibility |
|---|---|
| `InboundRouter` | Routes inbound messages to correct conversation/session |
| `OutboundDispatcher` | Routes outbound messages to correct channel adapter |
| `DeduplicationService` | Prevents duplicate message processing |
| `RateLimiter` | Per-tenant, per-channel rate limiting |
| `EventBus` | Redis-based pub/sub for cross-service communication |

### 5.3 Conversation / Session Manager

| Component | Responsibility |
|---|---|
| `ConversationManager` | Creates/loads conversations, manages turns, history |
| `SessionManager` | Session lifecycle, admission control, work leases |
| `IdentityResolver` | Cross-channel user identity mapping |
| `TenantManager` | Multi-tenant isolation, configuration |

### 5.4 Agent Orchestrator

| Component | Responsibility |
|---|---|
| `AgentRunner` | Core agent loop — streaming LLM + tool execution |
| `LLMRouter` | Model selection, provider routing, failover |
| `MemoryEngine` | Long-term / working / episodic memory management |
| `ToolRegistry` | Tool discovery, validation, policy enforcement |
| `ContextEngine` | Prompt assembly, compaction, context window management |
| `WorkflowEngine` | DAG-based multi-step workflow orchestration |
| `Planner` | Task decomposition, goal tracking |

### 5.5 Execution Layer

| Component | Responsibility |
|---|---|
| `ToolExecutor` | Synchronous tool execution with approval flow |
| `JobQueue` | BullMQ-based background job processing |
| `JobScheduler` | Cron + one-shot scheduled task management |
| `IntegrationRunner` | External API integrations, webhook handling |

### 5.6 Storage

| Component | Responsibility |
|---|---|
| `PostgreSQL` | Conversations, sessions, tools, jobs, configuration, audit |
| `Redis` | Cache, pub/sub events, rate limiting, session locks, queue |
| `VectorStore` | Embedding storage, semantic search (pgvector or Qdrant) |

### 5.7 Cross-Cutting

| Component | Responsibility |
|---|---|
| `AuthService` | JWT issuance/validation, API key management, RBAC |
| `ObservabilityService` | Structured logging, distributed tracing (OpenTelemetry), metrics (Prometheus) |
| `ConfigService` | Runtime configuration, feature flags, hot-reload |
| `SecretsManager` | Secret storage, rotation, provider-specific credential management |

---

## 6. Data-Flow Diagrams

### 6.1 Inbound Message Flow (Slack → Agent → Response)

```
Slack Event (message.app_home)
    │
    ▼
SlackAdapter.onMessage()
    │ normalize to InboundMessage
    ▼
MessageGateway.route(inbound)
    │ deduplicate, rate-limit, auth
    ▼
ConversationManager.getOrCreateSession(channel, user, thread)
    │ resolve/create session, load history
    ▼
AgentOrchestrator.processMessage(session, message)
    │
    ├──▶ MemoryEngine.recall(session, message)
    │       │ vector search + recency fetch
    │       ▼
    │    ContextAssembler.build(session, message, memories)
    │       │ system prompt + history + tools + context
    │       ▼
    ├──▶ LLMRouter.stream(request)
    │       │ select model, route to provider
    │       ▼
    │    AgentLoop.run(context)
    │       │ stream response events
    │       ├── tool_call → ToolRegistry.resolve → ToolExecutor.execute
    │       │                    │ return result → continue loop
    │       ├── text_delta → buffer for delivery
    │       └── stop_reason → finalize
    │
    ▼
OutboundDispatcher.send(channel, OutboundMessage)
    │
    ▼
SlackAdapter.renderAndSend(outbound)
    │ render to Block Kit, send via WebClient
    ▼
Slack delivers to user
```

### 6.2 Background Job Flow

```
Agent decides to schedule background work
    │
    ▼
ToolExecutor.execute("schedule_background_job", { ... })
    │
    ▼
JobQueue.enqueue(job)
    │ persist to PostgreSQL (status: queued)
    │ push to Redis queue
    ▼
BackgroundWorker.pickup()
    │ claim job (status: running)
    │
    ├──▶ Execute tool/integration
    │
    ▼
JobQueue.complete(job, result)
    │ status: succeeded/failed
    │ notify via EventBus
    ▼
ConversationManager.sendNotification(user, result)
    │
    ▼
ChannelAdapter.deliver(user, notification)
```

### 6.3 Memory Lifecycle

```
User message arrives
    │
    ▼
MemoryEngine.onMessage(conversation, message)
    │ extract facts, entities, intent
    │ store in working memory (Redis)
    ▼
After conversation turn completes:
    │
    ▼
MemoryEngine.consolidate(conversation)
    │ extract significant facts
    │ generate embeddings
    │ store in long-term memory (PostgreSQL + VectorStore)
    ▼
Periodic background (every 3 hours):
    │
    ▼
MemoryConsolidationJob.run()
    │ review recent conversations
    │ merge/split/update memories
    │ prune stale memories
    │ update embeddings
    ▼
Memory is ready for recall in next conversation
```

---

## 7. Technology Decisions

### 7.1 Runtime

| Decision | Choice | Reasoning |
|---|---|---|
| Language | **TypeScript** | Consistent with OpenClaw; strong typing; rich ecosystem; team expertise |
| Runtime | **Node.js 22+ LTS** | Stable, production-grade, aligned with OpenClaw requirements |
| Package Manager | **pnpm** | Workspace support; strict dependency resolution; consistent with OpenClaw |
| Module System | **ESM** | Modern; tree-shakeable; aligned with OpenClaw |

### 7.2 Storage

| Decision | Choice | Reasoning |
|---|---|---|
| Primary Database | **PostgreSQL 16** | ACID, JSONB, full-text search, mature, horizontal read replicas |
| ORM | **Drizzle ORM** | Type-safe, SQL-like API, excellent PostgreSQL support, lightweight |
| Cache / Pub-Sub | **Redis 7** | Battle-tested, pub/sub, streams, rate limiting, locks, TTL |
| Vector Storage | **pgvector** (initial) | Single database dependency; upgrade to Qdrant if scale demands |
| Object Storage | **S3-compatible** | Media files, exports, backups |

### 7.3 Background Processing

| Decision | Choice | Reasoning |
|---|---|---|
| Job Queue | **BullMQ** | Redis-backed, reliable, delayed/recurring jobs, retries, rate limiting |
| Cron | **node-cron + BullMQ repeatable jobs** | Simple scheduling + distributed execution |
| Event Bus | **Redis Streams** | Durable, consumer groups, ordering guarantees |

### 7.4 API / Transport

| Decision | Choice | Reasoning |
|---|---|---|
| HTTP API | **Hono** | Lightweight, fast, TypeScript-native, edge-compatible |
| WebSocket | **ws** (or Hono upgrade) | Low overhead, aligns with OpenClaw gateway pattern |
| Real-time Streaming | **SSE** | Simpler than WebSocket for server→client streaming |
| RPC Protocol | **JSON-RPC 2.0** | Standard, well-tested, aligns with OpenClaw gateway protocol |

### 7.5 Authentication & Security

| Decision | Choice | Reasoning |
|---|---|---|
| JWT | **jose** library | Standards-compliant JOSE/JWT/JWK, zero dependencies |
| Password Hashing | **argon2** | Memory-hard, GPU-resistant, OWASP recommended |
| API Keys | **HMAC-SHA256** | Fast, stateless verification |
| RBAC | **Custom + casl** | Flexible authorization library for TypeScript |

### 7.6 Observability

| Decision | Choice | Reasoning |
|---|---|---|
| Structured Logging | **pino** | Fastest Node.js logger, JSON output, child loggers |
| Distributed Tracing | **OpenTelemetry** | Vendor-neutral, auto-instrumentation, standard |
| Metrics | **Prometheus client** | Standard metrics format, rich dashboard ecosystem |
| Error Tracking | **Sentry** (optional) | Rich error context, stack traces, breadcrumbs |

### 7.7 Testing

| Decision | Choice | Reasoning |
|---|---|---|
| Unit Testing | **vitest** | Fast, TypeScript-native, ESM-first |
| Integration Testing | **vitest + testcontainers** | Real PostgreSQL/Redis for integration tests |
| E2E Testing | **Playwright** | Browser testing for web chat |
| API Testing | **supertest** | HTTP assertion library |

### 7.8 Build & Tooling

| Decision | Choice | Reasoning |
|---|---|---|
| Bundler | **tsdown** (Rollup-based) | Matches OpenClaw toolchain |
| Linter | **oxlint** | Fast, Rust-based, matches OpenClaw |
| Formatter | **oxfmt** | Matches OpenClaw |
| Type Checker | **tsc** + **tsgo** | TypeScript strict mode |

---

## 8. Proposed Directory Structure

```
hermes/
├── architecture.md                    # This document
├── package.json                       # Root workspace package
├── pnpm-workspace.yaml                # pnpm workspace config
├── tsconfig.json                      # Root TypeScript config
│
├── apps/
│   └── server/                        # Main Hermes server application
│       ├── src/
│       │   ├── index.ts               # Entry point
│       │   ├── server.ts              # HTTP/WS server setup
│       │   ├── config.ts              # Configuration loading
│       │   └── bootstrap.ts           # Service initialization
│       ├── package.json
│       └── tsconfig.json
│
├── packages/
│   ├── core/                          # Core contracts and types
│   │   └── src/
│   │       ├── message.ts             # Canonical message types
│   │       ├── session.ts             # Session types
│   │       ├── conversation.ts        # Conversation types
│   │       ├── tool.ts                # Tool definitions
│   │       ├── agent.ts               # Agent types
│   │       ├── channel.ts             # Channel adapter contract
│   │       ├── memory.ts              # Memory types
│   │       ├── job.ts                 # Job types
│   │       └── events.ts              # Event types
│   │
│   ├── gateway/                       # Message Gateway
│   │   └── src/
│   │       ├── router.ts              # Inbound message routing
│   │       ├── dispatcher.ts          # Outbound message dispatch
│   │       ├── dedup.ts               # Deduplication
│   │       ├── rate-limiter.ts        # Rate limiting
│   │       └── middleware/            # Gateway middleware
│   │
│   ├── agent/                         # Agent Orchestrator
│   │   └── src/
│   │       ├── orchestrator.ts        # Main orchestrator
│   │       ├── runner.ts              # Agent loop runner
│   │       ├── llm-router.ts          # Model selection & routing
│   │       ├── context-engine.ts      # Prompt assembly
│   │       ├── memory-engine.ts       # Memory management
│   │       ├── tool-registry.ts       # Tool discovery & policy
│   │       └── planner.ts             # Task decomposition
│   │
│   ├── memory/                        # Memory System
│   │   └── src/
│   │       ├── engine.ts              # Memory engine
│   │       ├── working-memory.ts      # Short-term (Redis)
│   │       ├── long-term-memory.ts    # Persistent (PostgreSQL)
│   │       ├── episodic-memory.ts     # Event-based (VectorStore)
│   │       ├── embeddings.ts          # Embedding generation
│   │       ├── consolidation.ts       # Memory consolidation
│   │       └── recall.ts              # Memory retrieval
│   │
│   ├── tools/                         # Built-in Tool Collection
│   │   └── src/
│   │       ├── filesystem.ts          # File operations
│   │       ├── shell.ts               # Shell command execution
│   │       ├── web-fetch.ts           # HTTP fetching
│   │       ├── web-search.ts          # Web search
│   │       ├── scheduler.ts           # Job scheduling
│   │       ├── notifications.ts       # Notification sending
│   │       └── approvals.ts           # Approval flow
│   │
│   ├── workflow/                      # Workflow Engine
│   │   └── src/
│   │       ├── engine.ts              # DAG execution engine
│   │       ├── scheduler.ts           # Step scheduling
│   │       ├── state-machine.ts       # Workflow state management
│   │       └── steps/                 # Step executors
│   │
│   ├── storage/                       # Data Access Layer
│   │   └── src/
│   │       ├── db.ts                  # PostgreSQL connection (Drizzle)
│   │       ├── redis.ts               # Redis connection
│   │       ├── vector.ts              # Vector store connection
│   │       ├── schema/                # Drizzle schema definitions
│   │       │   ├── conversations.ts
│   │       │   ├── messages.ts
│   │       │   ├── sessions.ts
│   │       │   ├── memories.ts
│   │       │   ├── tools.ts
│   │       │   ├── jobs.ts
│   │       │   ├── tenants.ts
│   │       │   └── audit.ts
│   │       ├── migrations/            # Database migrations
│   │       └── repositories/          # Data access objects
│   │
│   ├── auth/                          # Authentication & Authorization
│   │   └── src/
│   │       ├── jwt.ts                 # JWT management
│   │       ├── api-keys.ts            # API key management
│   │       ├── rbac.ts                # Role-based access control
│   │       ├── middleware.ts          # Auth middleware
│   │       └── providers/            # Auth providers
│   │
│   ├── observability/                 # Observability
│   │   └── src/
│   │       ├── logger.ts              # Structured logging (pino)
│   │       ├── tracer.ts              # Distributed tracing (OTEL)
│   │       ├── metrics.ts             # Metrics (Prometheus)
│   │       └── middleware.ts          # Request logging middleware
│   │
│   ├── jobs/                          # Background Job System
│   │   └── src/
│   │       ├── queue.ts               # BullMQ queue setup
│   │       ├── workers/               # Job workers
│   │       │   ├── tool-worker.ts     # Background tool execution
│   │       │   ├── consolidation-worker.ts  # Memory consolidation
│   │       │   └── notification-worker.ts   # Notification delivery
│   │       ├── scheduler.ts           # Cron scheduling
│   │       └── monitor.ts             # Job monitoring
│   │
│   └── config/                        # Configuration
│       └── src/
│           ├── schema.ts              # Config schema (Zod)
│           ├── loader.ts              # Config loading
│           ├── defaults.ts            # Default values
│           └── hot-reload.ts          # Runtime config updates
│
├── channels/
│   ├── slack/                         # Slack Channel Adapter
│   │   └── src/
│   │       ├── adapter.ts             # ChannelAdapter implementation
│   │       ├── bolt-app.ts            # Bolt app setup
│   │       ├── events.ts              # Event handlers
│   │       ├── blocks.ts              # Block Kit rendering
│   │       ├── threads.ts             # Thread management
│   │       └── streaming.ts           # Message streaming
│   │
│   ├── whatsapp/                      # WhatsApp Channel Adapter
│   │   └── src/
│   │       ├── adapter.ts             # ChannelAdapter implementation
│   │       ├── session.ts             # Baileys session management
│   │       ├── media.ts               # Media handling
│   │       └── groups.ts              # Group support
│   │
│   └── web/                           # Web Chat Channel Adapter
│       └── src/
│           ├── adapter.ts             # ChannelAdapter implementation
│           ├── ws-server.ts           # WebSocket server
│           ├── api.ts                 # REST API endpoints
│           ├── streaming.ts           # SSE streaming
│           └── ui/                    # Embeddable web chat UI
│               ├── components/
│               └── styles/
│
├── extensions/                        # Plugin Extensions
│   ├── memory-pgvector/               # PostgreSQL vector memory plugin
│   ├── workflow-basic/                # Basic workflow plugin
│   ├── tool-github/                   # GitHub integration tool
│   └── ...
│
├── ui/                                # Admin Dashboard (optional)
│   └── src/
│       ├── pages/
│       │   ├── dashboard/
│       │   ├── conversations/
│       │   ├── settings/
│       │   └── monitoring/
│       └── components/
│
├── db/
│   ├── migrations/                    # Drizzle migrations
│   └── seeds/                         # Seed data
│
├── deploy/                            # Deployment configs
│   ├── docker/
│   │   ├── Dockerfile
│   │   └── docker-compose.yml
│   ├── fly.toml
│   └── k8s/                           # Kubernetes manifests
│
├── scripts/                           # Build/dev scripts
│
└── test/                              # Test infrastructure
    ├── fixtures/
    ├── helpers/
    └── integration/
```

---

## 9. Implementation Roadmap

### Phase 1: Foundation (Weeks 1-3)

**Goal**: Project scaffolding, core contracts, database layer.

| Task | Priority | Effort | Dependencies |
|---|---|---|---|
| Initialize pnpm workspace, TypeScript config, build tooling | P0 | 1d | None |
| Define core contract types (`packages/core/`) | P0 | 2d | None |
| Set up PostgreSQL with Drizzle ORM, write schema migrations | P0 | 3d | Task 1 |
| Set up Redis connection + basic pub/sub | P0 | 1d | Task 1 |
| Implement base server (Hono HTTP + WebSocket) | P0 | 2d | Task 1 |
| Implement JWT auth + API key management | P0 | 2d | Task 4 |
| Implement basic observability (pino logger + OTEL trace init) | P1 | 1d | Task 1 |
| Write integration test infrastructure (testcontainers) | P1 | 2d | Task 3,4 |

**Deliverable**: Bootable server with auth, PostgreSQL, Redis, basic HTTP/WS endpoints.

### Phase 2: Channel Layer (Weeks 4-6)

**Goal**: Multi-channel messaging with Slack and WhatsApp.

| Task | Priority | Effort | Dependencies |
|---|---|---|---|
| Implement `ChannelAdapter` contract + `ChannelRegistry` | P0 | 2d | Phase 1 |
| Implement `MessageGateway` (routing, dedup, rate limiting) | P0 | 3d | Task 1 |
| Implement Slack adapter (Bolt, Socket Mode) | P0 | 3d | Task 1 |
| Implement WhatsApp adapter (Baileys) | P0 | 3d | Task 1 |
| Implement canonical message normalization | P0 | 2d | Task 1 |
| Implement web chat adapter (WebSocket + SSE) | P1 | 3d | Task 1 |
| Cross-channel session binding | P1 | 2d | Phase 1 |

**Deliverable**: Slack + WhatsApp channels receiving and responding to messages.

### Phase 3: Agent Core (Weeks 7-10)

**Goal**: LLM-powered agent with tool execution.

| Task | Priority | Effort | Dependencies |
|---|---|---|---|
| Implement `AgentRunner` (adapt from OpenClaw agent loop) | P0 | 4d | Phase 1,2 |
| Implement `LLMRouter` (OpenAI + Anthropic initially) | P0 | 3d | Phase 1 |
| Implement `ToolRegistry` + basic tools (shell, web-fetch, fs) | P0 | 3d | Task 1 |
| Implement `ContextEngine` (prompt assembly, history, compaction) | P0 | 3d | Task 1,2 |
| Implement conversation persistence (PostgreSQL) | P0 | 2d | Phase 1 |
| Implement streaming responses to channels | P0 | 2d | Task 1, Phase 2 |
| Tool approval flow | P1 | 2d | Task 3 |

**Deliverable**: Agent that can have conversations, use tools, and respond across channels.

### Phase 4: Memory System (Weeks 11-13)

**Goal**: Long-term memory with semantic search.

| Task | Priority | Effort | Dependencies |
|---|---|---|---|
| Implement `MemoryEngine` interface + working memory (Redis) | P0 | 2d | Phase 1,3 |
| Implement long-term memory (PostgreSQL + pgvector) | P0 | 3d | Task 1 |
| Implement embedding generation (OpenAI embeddings) | P0 | 1d | Task 2 |
| Implement memory consolidation job (background) | P0 | 2d | Task 2, Phase 1 |
| Implement semantic recall for context assembly | P0 | 2d | Task 2, Phase 3 |
| Implement episodic memory (event-based) | P1 | 2d | Task 2 |

**Deliverable**: Agent remembers context across conversations with semantic search.

### Phase 5: Background Jobs & Workflows (Weeks 14-16)

**Goal**: Reliable background processing and multi-step workflows.

| Task | Priority | Effort | Dependencies |
|---|---|---|---|
| Set up BullMQ + Redis queue infrastructure | P0 | 2d | Phase 1 |
| Implement job workers (tool execution, notifications) | P0 | 3d | Task 1, Phase 3 |
| Implement cron scheduler (recurring jobs) | P0 | 2d | Task 1 |
| Implement `WorkflowEngine` (DAG execution) | P1 | 4d | Task 1 |
| Implement job monitoring + status API | P1 | 2d | Task 1 |
| Implement job retry + error handling | P1 | 2d | Task 1 |

**Deliverable**: Background jobs, scheduled tasks, and multi-step workflows.

### Phase 6: Production Hardening (Weeks 17-20)

**Goal**: Observability, security, deployment, testing.

| Task | Priority | Effort | Dependencies |
|---|---|---|---|
| Full OpenTelemetry integration (traces + metrics) | P0 | 3d | Phase 1 |
| Prometheus metrics endpoint | P0 | 1d | Task 1 |
| Structured audit logging | P0 | 2d | Phase 1 |
| RBAC implementation | P0 | 2d | Phase 1 |
| Rate limiting (per-tenant, per-channel) | P0 | 1d | Phase 2 |
| Docker + docker-compose deployment | P0 | 2d | All phases |
| Comprehensive integration test suite | P0 | 4d | All phases |
| API documentation (OpenAPI spec) | P1 | 2d | All phases |
| Load testing + performance tuning | P1 | 3d | All phases |
| Web chat UI (embeddable component) | P2 | 4d | Phase 2,3 |

**Deliverable**: Production-ready deployment with full observability, security, and tests.

---

## Appendix A: OpenClaw Reuse Strategy

We are **not** forking OpenClaw. Instead, we are:

1. **Studying** OpenClaw's proven patterns (agent loop, tool system, channel abstraction, plugin architecture)
2. **Adapting** concepts and algorithms to our PostgreSQL/Redis architecture
3. **Rewriting** storage and infrastructure layer for server-side deployment
4. **Extending** with features OpenClaw lacks (multi-tenancy, event bus, workflow engine, vector memory)

Key adaptations from OpenClaw:

| OpenClaw Component | Hermes Adaptation |
|---|---|
| `packages/agent-core/agent-loop.ts` | Adapted agent loop with PostgreSQL-backed sessions |
| `src/channels/plugins/types.plugin.ts` | Simplified `ChannelAdapter` contract |
| `src/plugins/tools.ts` | `ToolRegistry` with Redis-cached policies |
| `src/context-engine/` | `ContextEngine` with PostgreSQL history + vector recall |
| `extensions/memory-core/` | Multi-tier memory (working/long-term/episodic) |
| `src/cron/` | BullMQ-based distributed job scheduling |
| `src/sessions/` | PostgreSQL-backed session lifecycle |
| `src/gateway/server.ts` | Hono-based HTTP/WS server |

---

## Appendix B: Environment Variables

```env
# Database
DATABASE_URL=postgresql://hermes:secret@localhost:5432/hermes
REDIS_URL=redis://localhost:6379

# LLM Providers
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...

# Slack
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
SLACK_SIGNING_SECRET=...

# WhatsApp (Baileys session data path)
WHATSAPP_AUTH_DIR=./data/whatsapp-auth

# Auth
JWT_SECRET=your-256-bit-secret
API_KEY_HMAC_SECRET=your-hmac-secret

# Observability
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
LOG_LEVEL=info

# Server
PORT=3000
HOST=0.0.0.0
NODE_ENV=production
```

---

## Appendix C: Database Schema (High-Level)

```sql
-- Tenants
CREATE TABLE tenants (
  id UUID PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  config JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Users
CREATE TABLE users (
  id UUID PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id),
  email VARCHAR(255) UNIQUE,
  display_name VARCHAR(255),
  channel_identities JSONB DEFAULT '{}',  -- {"slack": "U123", "whatsapp": "+1..."}
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Conversations
CREATE TABLE conversations (
  id UUID PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id),
  channel VARCHAR(50) NOT NULL,
  channel_conversation_id VARCHAR(255),
  title VARCHAR(500),
  status VARCHAR(20) DEFAULT 'active',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Messages
CREATE TABLE messages (
  id UUID PRIMARY KEY,
  conversation_id UUID REFERENCES conversations(id),
  role VARCHAR(20) NOT NULL,  -- user, assistant, system, tool
  content TEXT,
  tool_calls JSONB,
  tool_results JSONB,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at);

-- Sessions
CREATE TABLE sessions (
  id UUID PRIMARY KEY,
  conversation_id UUID REFERENCES conversations(id),
  agent_id VARCHAR(100) NOT NULL,
  status VARCHAR(20) DEFAULT 'active',
  context_window JSONB,
  token_usage INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_active_at TIMESTAMPTZ DEFAULT NOW()
);

-- Memories
CREATE TABLE memories (
  id UUID PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id),
  user_id UUID REFERENCES users(id),
  type VARCHAR(20) NOT NULL,  -- working, long_term, episodic
  content TEXT NOT NULL,
  embedding vector(1536),
  metadata JSONB DEFAULT '{}',
  importance FLOAT DEFAULT 0.5,
  last_accessed_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);
CREATE INDEX idx_memories_tenant ON memories(tenant_id);
CREATE INDEX idx_memories_embedding ON memories USING ivfflat (embedding vector_cosine_ops);

-- Jobs
CREATE TABLE jobs (
  id UUID PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id),
  type VARCHAR(100) NOT NULL,
  status VARCHAR(20) DEFAULT 'queued',
  payload JSONB,
  result JSONB,
  error TEXT,
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  scheduled_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Audit Log
CREATE TABLE audit_log (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID,
  user_id UUID,
  action VARCHAR(100) NOT NULL,
  resource_type VARCHAR(100),
  resource_id UUID,
  details JSONB DEFAULT '{}',
  ip_address INET,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```
