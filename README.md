# che-dashboard-plugins

Plugin packages for [Eclipse Che Dashboard](https://github.com/eclipse-che/che-dashboard).

Each plugin extends the dashboard with new UI features, backend routes, and Redux stores without modifying the dashboard core.

## Plugins

| Plugin | Description | Status |
|--------|-------------|--------|
| [`ai-selector`](./ai-selector) | AI tool selection in workspace overview (provider keys, registry) | Enabled |
| [`dashboard-ai-agent`](./dashboard-ai-agent) | Devfile editor with AI agent terminal (Claude Code via ttyd) | Enabled |

---

## Development Guide

### Prerequisites

- [Eclipse Che Dashboard](https://github.com/eclipse-che/che-dashboard) checked out locally
- Node.js 20+, Yarn 4+
- [CRC](https://developers.redhat.com/products/openshift-local/overview) (OpenShift Local) running with Eclipse Che installed

### How plugins work

Each plugin directory has a `plugin.json` manifest and two sub-directories:

```
<plugin-name>/
├── plugin.json          # Manifest: id, name, version, enabled flag, entry points
├── frontend/            # React components, Redux stores, services
│   └── plugin.tsx       # Plugin entry point — registers slots (nav items, tabs, etc.)
└── backend/             # Fastify routes, helpers, services
    └── routes/          # Route registration functions
```

The dashboard uses symlinks to mount plugins into its source tree:

```
packages/dashboard-frontend/src/plugins/<plugin-name> -> ../../../../plugins/<plugin-name>/frontend
packages/dashboard-backend/src/plugins/<plugin-name>  -> ../../../../plugins/<plugin-name>/backend
```

Plugin routes are registered manually in `packages/dashboard-backend/src/app.ts`.
Plugin frontend entry points are auto-registered via `scripts/prepare-plugins.sh` → `packages/dashboard-frontend/src/plugins/index.ts`.

### Setting up the development environment

**1. Clone the dashboard and this repo:**

```bash
git clone git@github.com:eclipse-che/che-dashboard.git
git clone git@github.com:olexii4/che-dashboard-plugins.git
```

**2. Copy plugins into the dashboard:**

```bash
cp -r che-dashboard-plugins/ai-selector        che-dashboard/plugins/
cp -r che-dashboard-plugins/dashboard-ai-agent che-dashboard/plugins/
```

**3. Prepare and build:**

```bash
cd che-dashboard
bash scripts/prepare-plugins.sh   # creates symlinks in src/plugins/, generates index.ts
yarn install
yarn build
```

### Fast local deploy to CRC

After making changes, rebuild and deploy to your CRC cluster:

```bash
# Build JS locally and load image directly into CRC (no registry push)
yarn local:patch

# Or build JS separately, then skip the build step in packaging (faster incremental):
yarn build && SKIP_BUILD=1 yarn local:patch
```

> `yarn local:patch` builds for `linux/arm64` (native on Apple Silicon), saves the image as a tar,
> copies it to the CRC VM via SSH, loads it with podman, and patches the CheCluster CR.
> No registry push/pull — much faster than `yarn deploy:patch`.

### Enabling / disabling a plugin

Set `"enabled": true/false` in the plugin's `plugin.json`, then re-run:

```bash
bash scripts/prepare-plugins.sh
yarn build
```

### Adding a new plugin

1. Create a directory under `plugins/<your-plugin>/` with `plugin.json`, `frontend/plugin.tsx`, and optional `backend/` routes.
2. Register backend routes in `packages/dashboard-backend/src/app.ts`.
3. Run `bash scripts/prepare-plugins.sh` to auto-generate the frontend registration.
4. Extend `PluginSlots` in `packages/dashboard-plugins/src/types.ts` if new UI extension points are needed.

### AI Agent Registry ConfigMap

The `dashboard-ai-agent` plugin reads agent definitions from a Kubernetes ConfigMap in the `eclipse-che` namespace:

```bash
kubectl apply -f - <<'EOF'
apiVersion: v1
kind: ConfigMap
metadata:
  name: ai-agent-registry
  namespace: eclipse-che
  labels:
    app.kubernetes.io/component: ai-agent-registry
    app.kubernetes.io/part-of: che.eclipse.org
data:
  registry.json: |
    {
      "agents": [
        {
          "id": "dashboard-agent",
          "name": "Dashboard Agent",
          "publisher": "Eclipse Che",
          "description": "AI agent powered by Claude Code for building and troubleshooting Devfiles and DevWorkspaces",
          "icon": "",
          "docsUrl": "https://github.com/olexii4/che-dashboard-agent",
          "image": "quay.io/oorel/dashboard-agent",
          "tag": "next",
          "memoryLimit": "896Mi",
          "cpuLimit": "1",
          "terminalPort": 8080,
          "env": [],
          "initCommand": "claude --dangerously-skip-permissions --append-system-prompt \"CRITICAL RULES: 1) EVERY non-UDI container MUST have args: [tail, -f, /dev/null]. 2) NEVER use python3, awk, perl, node — use jq, sed, cut, curl.\""
        }
      ],
      "defaultAgentId": "dashboard-agent"
    }
EOF
```

The agent container image is built from [olexii4/che-dashboard-agent](https://github.com/olexii4/che-dashboard-agent).
