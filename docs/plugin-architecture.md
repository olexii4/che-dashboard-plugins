# Plugin Architecture: What Lives Where and Why

## Overview

The che-dashboard plugin system consists of two repositories:

| Repo | Purpose |
|------|---------|
| [`eclipse-che/che-dashboard`](https://github.com/eclipse-che/che-dashboard) (`plugins` branch / PR [#1552](https://github.com/eclipse-che/che-dashboard/pull/1552)) | Core dashboard + plugin infrastructure + required integration layer |
| [`olexii4/che-dashboard-plugins`](https://github.com/olexii4/che-dashboard-plugins) | Plugin implementations (ai-selector, dashboard-ai-agent, …) |

---

## Plugin System Structure in che-dashboard

```
packages/
├── dashboard-plugins/          # Plugin SDK (@eclipse-che/dashboard-plugins)
│   └── src/
│       ├── types.ts            # FrontendPlugin, BackendPlugin, PluginSlots interfaces
│       ├── registry.ts         # registerFrontendPlugin, bootstrapPlugins, hook runners
│       ├── frontend/
│       │   └── PluginSlot.tsx  # React component — renders plugin UI into named slots
│       ├── backend/
│       │   └── index.ts        # Backend plugin registration helpers
│       └── index.ts            # Public SDK entry point
│
└── dashboard-frontend/src/
    ├── plugin-registry/
    │   ├── index.ts            # Runtime plugin registry (frontend)
    │   └── PluginSlot.tsx      # Consumes plugin slots in dashboard pages
    ├── store/
    │   ├── LocalDevfiles/      # ⚠️ Core integration layer (see below)
    │   ├── AiAgentRegistry/    # AI agent registry Redux store
    │   ├── DevfileSchema/      # Devfile JSON schema store
    │   └── DevWorkspaceSchema/ # DevWorkspace JSON schema store
    └── services/bootstrap/
        └── index.ts            # Calls bootstrapPlugins() + subscribeToAgentPodChanges()
```

### Plugin Slot Names

Slots defined in `PluginSlots` interface (types.ts):

| Slot | Location in UI |
|------|---------------|
| `workspaceCreation` | Get Started / Create Workspace page |
| `workspaceDetailsOverview` | Workspace details overview tab |
| `workspacesListColumn` | Extra column in workspaces list table |
| `userPreferencesTab` | Extra tab in User Preferences |
| `factoryParams` | Factory URL parameter extensions |
| `navigationItems` | Sidebar navigation items |
| `loaderTabs` | Workspace loader progress tabs |

---

## `store/LocalDevfiles/index.ts` — The Core Integration Layer

This is the most critical file added by PR #1552. It lives in the main dashboard code for structural reasons.

### What it implements

1. **LocalDevfile state** — Redux store slice for AI-agent-managed devfiles stored as Kubernetes ConfigMaps:
   - `LocalDevfile` model (id, name, description, content, projectNames)
   - CRUD actions (requestStart, requestSuccess, addDevfile, updateDevfile, removeDevfile)

2. **AgentPodStatus state** — Tracks lifecycle of AI agent pods:
   - `AgentPodPhase` enum (Pending / Running / Succeeded / Failed / Unknown)
   - `AgentPodStatus` model (agentId, name, phase, ready, serviceUrl)
   - `upsertAgentPodStatus`, `removeAgentPodStatus` actions

3. **WebSocket subscriptions** — Two long-lived listeners registered at boot:
   - `subscribeToConfigMapChanges()` — listens on `CONFIGMAP` WS channel to receive real-time devfile updates from the agent
   - `subscribeToAgentPodChanges()` — listens on `POD` WS channel to track agent pod lifecycle

4. **Agent lifecycle actions** — HTTP-based operations:
   - `startAgent(agentId)` — launches AI agent pod via backend REST API
   - `stopAgent(agentId)` — deletes agent pod
   - `fetchAgentStatus(agentId)` — polls current pod status + service URL
   - `sendHeartbeat(agentId)` — keeps agent alive
   - `fetchAgentTerminalUrl(agentId)` — resolves the ttyd terminal proxy URL

5. **Devfile CRUD actions** — Fetch, create, update, delete devfiles via ConfigMap backend API.

### Why it MUST be in the main che-dashboard code (not in a plugin)

| Reason | Detail |
|--------|--------|
| **Redux root reducer wiring** | `localDevfilesReducer` is registered in `store/rootReducer.ts` at app startup. Redux reducers cannot be dynamically added after the store is created without complex middleware (e.g. `redux-dynamic-modules`). Moving this to a plugin would require adding dynamic reducer injection to the dashboard core — a significant architectural change. |
| **Bootstrap lifecycle coupling** | `services/bootstrap/index.ts` calls `subscribeToAgentPodChanges()` immediately after pods are fetched — before plugins are bootstrapped. Agent pod tracking must be active from the start so that pods that already exist are reflected in UI state correctly. |
| **WebSocket infrastructure access** | `subscribeToConfigMapChanges()` and `subscribeToAgentPodChanges()` call `container.get(WebsocketClient)` (InversifyJS IoC container) and use the dashboard's internal WebSocket subscription manager. Plugins have no access to this internal container. |
| **Cross-cutting data dependency** | `subscribeToAgentPodChanges()` reads from `state.pods.pods` (the dashboard's existing pod store) to initialize agent status from already-fetched pods. A plugin cannot reliably depend on the order in which core stores and plugin stores are initialized. |
| **Single WebSocket connection** | The dashboard opens one persistent WebSocket connection per channel. Adding a second listener from a plugin for the `POD` channel would require deduplication logic that currently lives only in the core subscription manager. |
| **Security boundary** | Agent pod management (start/stop/heartbeat) proxies through the dashboard backend, which validates Kubernetes RBAC. Placing the HTTP client in a plugin would bypass dashboard-level request auditing. |

**Summary:** The `LocalDevfiles` store is the integration seam between the dashboard's core Kubernetes infrastructure (WebSockets, RBAC-gated backend routes, Redux store, InversifyJS IoC) and the plugin-provided AI agent UI. Until the dashboard core gains dynamic reducer injection and a plugin-accessible WebSocket subscription API, this layer must remain in the main codebase.

---

## What Currently Lives in Plugins Repo

```
che-dashboard-plugins/
├── ai-selector/
│   ├── frontend/   # AI provider selector UI (workspace overview tab, user preferences)
│   └── backend/    # AI provider key storage (Kubernetes Secrets)
└── dashboard-ai-agent/
    ├── frontend/   # Agent navigation, devfile editor, terminal panel
    └── backend/    # Agent pod management routes, ttyd proxy
```

---

## What Could Move from che-dashboard to Plugins (Step-by-Step Plan)

### Prerequisite: Dynamic Reducer Injection

Before any Redux state can move to plugins, the dashboard core needs a mechanism to inject reducers at plugin bootstrap time. This is a one-time investment.

**Suggested approach:** Use `store.replaceReducer()` pattern or a `createInjectableReducer` helper in `packages/dashboard-plugins/src/registry.ts`.

---

### Phase 1 — Move shared constants (low risk, no dependencies)

| File | Target |
|------|--------|
| `packages/common/src/constants/terminalThemes.ts` | `che-dashboard-plugins/packages/stubs/src/constants/terminalThemes.ts` |
| `packages/dashboard-backend/src/constants/terminal-themes.ts` | `dashboard-ai-agent/backend/constants/terminal-themes.ts` |

These files are consumed only by the plugin packages. Moving them removes non-plugin constants from the shared `@eclipse-che/common` package.

---

### Phase 2 — Move backend routes (self-contained Fastify plugins)

| File | Target |
|------|--------|
| `packages/dashboard-backend/src/devworkspaceClient/services/aiProviderKeyApi.ts` | `ai-selector/backend/services/aiProviderKeyApi.ts` |
| `packages/dashboard-backend/src/devworkspaceClient/services/aiRegistryApi.ts` | `ai-selector/backend/services/aiRegistryApi.ts` |
| `packages/dashboard-backend/src/routes/api/helpers/agentPod.ts` | `dashboard-ai-agent/backend/routes/agentPod.ts` |
| `packages/dashboard-backend/src/routes/api/helpers/terminal/index.ts` | `dashboard-ai-agent/backend/routes/terminal.ts` |
| `packages/dashboard-backend/src/routes/api/helpers/devfile/index.ts` | `dashboard-ai-agent/backend/routes/devfile.ts` |

These are Fastify route handlers registered via `BackendPlugin.registerRoutes()`. They are already logically plugin-specific. The backend plugin API already supports this pattern.

---

### Phase 3 — Move frontend schema stores (after dynamic reducers land)

| File | Target |
|------|--------|
| `packages/dashboard-frontend/src/store/DevfileSchema/` | `dashboard-ai-agent/frontend/store/DevfileSchema/` |
| `packages/dashboard-frontend/src/store/DevWorkspaceSchema/` | `dashboard-ai-agent/frontend/store/DevWorkspaceSchema/` |
| `packages/dashboard-frontend/src/services/backend-client/devfileSchemaApi.ts` | `dashboard-ai-agent/frontend/services/devfileSchemaApi.ts` |
| `packages/dashboard-frontend/src/services/backend-client/devworkspaceSchemaApi.ts` | `dashboard-ai-agent/frontend/services/devworkspaceSchemaApi.ts` |

These stores are only used by the devfile editor in the `dashboard-ai-agent` plugin. Once dynamic reducer injection is available, the plugin can register these reducers at bootstrap time.

---

### Phase 4 — Extract Agent lifecycle from LocalDevfiles (long-term, requires core API)

The agent start/stop/heartbeat/status actions in `store/LocalDevfiles/index.ts` are plugin logic embedded in core. The long-term goal is:

1. Add a **plugin-accessible WebSocket subscription API** to the dashboard SDK (e.g. `subscribeToChannel(channel, listener)` exported from `@eclipse-che/dashboard-plugins`).
2. Add **dynamic reducer injection** to the plugin bootstrap phase.
3. Move `AgentPodStatus` state + WebSocket listeners to `dashboard-ai-agent/frontend/store/agentPods.ts`.
4. Keep only the `LocalDevfile` (ConfigMap-backed devfile) state in core if it is reused by other parts of the dashboard; otherwise move that too.

This phase requires core API changes and is the highest-effort step.

---

### Phase 5 — Move UI components

| File | Target |
|------|--------|
| `packages/dashboard-frontend/src/components/LoaderAgentPanelTab/index.tsx` | `dashboard-ai-agent/frontend/components/LoaderAgentPanelTab/` |

This component is registered via the `loaderTabs` plugin slot and has no reason to exist in the dashboard core once the slot machinery is fully in place.
