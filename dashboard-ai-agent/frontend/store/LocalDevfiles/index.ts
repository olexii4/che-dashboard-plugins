/*
 * Copyright (c) 2018-2025 Red Hat, Inc.
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 *
 * Contributors:
 *   Red Hat, Inc. - initial API and implementation
 */

import { api } from '@eclipse-che/common';
import { createAction, createReducer } from '@reduxjs/toolkit';
import { load } from 'js-yaml';

import { container } from '@/inversify.config';
import { WebsocketClient } from '@/services/backend-client/websocketClient';
import { ChannelListener } from '@/services/backend-client/websocketClient/messageHandler';
import { AppThunk } from '@/store';
import { selectDefaultNamespace } from '@/store/InfrastructureNamespaces/selectors';

// API base paths
const DEVFILES_API_BASE = '/dashboard/api/devfiles/namespace';
const AGENTS_API_BASE = '/dashboard/api/namespace';

// HTTP status codes
const HTTP_TOO_MANY_REQUESTS = 429;

// Default values
const DEFAULT_TERMINAL_PORT = 8080;
const MAX_RETRIES = 3;

// Regex patterns
const REGEX_RETRY_IN = /retry in (\d+)/i;
const REGEX_NAME = /^\s*name:\s*(.+)$/m;
const REGEX_GENERATE_NAME = /^\s*generateName:\s*(.+)$/m;
const REGEX_DESCRIPTION = /^\s*description:\s*(.+)$/m;

export interface LocalDevfile {
  id: string;
  name: string;
  description: string;
  content: string;
  projectNames: string[];
  lastModified: string;
}

export enum AgentPodPhase {
  PENDING = 'Pending',
  RUNNING = 'Running',
  SUCCEEDED = 'Succeeded',
  FAILED = 'Failed',
  UNKNOWN = 'Unknown',
}

export interface AgentPodStatus {
  agentId: string;
  name: string;
  phase: AgentPodPhase;
  ready: boolean;
  serviceUrl: string | undefined;
}

export interface LocalDevfilesState {
  devfiles: LocalDevfile[];
  isLoading: boolean;
  error: string | undefined;
  agentTerminalUrl: string | undefined;
  agentPodStatuses: AgentPodStatus[];
  configMapResourceVersion: string;
}

const initialState: LocalDevfilesState = {
  devfiles: [],
  isLoading: false,
  error: undefined,
  agentTerminalUrl: undefined,
  agentPodStatuses: [],
  configMapResourceVersion: '',
};

const requestStart = createAction('localDevfiles/requestStart');
const requestSuccess = createAction<LocalDevfile[]>('localDevfiles/requestSuccess');
const requestError = createAction<string>('localDevfiles/requestError');
const addDevfile = createAction<LocalDevfile>('localDevfiles/addDevfile');
const updateDevfileAction = createAction<LocalDevfile>('localDevfiles/updateDevfile');
const removeDevfile = createAction<string>('localDevfiles/removeDevfile');
const setAgentTerminalUrl = createAction<string | undefined>('localDevfiles/setAgentTerminalUrl');
const upsertAgentPodStatus = createAction<AgentPodStatus>('localDevfiles/upsertAgentPodStatus');
const removeAgentPodStatus = createAction<string>('localDevfiles/removeAgentPodStatus');
const setConfigMapResourceVersion = createAction<string>(
  'localDevfiles/setConfigMapResourceVersion',
);

export const localDevfilesReducer = createReducer(initialState, builder =>
  builder
    .addCase(requestStart, state => {
      state.isLoading = true;
      state.error = undefined;
    })
    .addCase(requestSuccess, (state, action) => {
      state.devfiles = action.payload;
      state.isLoading = false;
    })
    .addCase(requestError, (state, action) => {
      state.isLoading = false;
      state.error = action.payload;
    })
    .addCase(addDevfile, (state, action) => {
      state.devfiles.push(action.payload);
    })
    .addCase(updateDevfileAction, (state, action) => {
      const index = state.devfiles.findIndex(d => d.id === action.payload.id);
      if (index !== -1) {
        state.devfiles[index] = action.payload;
      }
    })
    .addCase(removeDevfile, (state, action) => {
      state.devfiles = state.devfiles.filter(d => d.id !== action.payload);
    })
    .addCase(setAgentTerminalUrl, (state, action) => {
      state.agentTerminalUrl = action.payload;
    })
    .addCase(upsertAgentPodStatus, (state, action) => {
      const idx = state.agentPodStatuses.findIndex(s => s.agentId === action.payload.agentId);
      if (idx >= 0) {
        state.agentPodStatuses[idx] = action.payload;
      } else {
        state.agentPodStatuses.push(action.payload);
      }
    })
    .addCase(removeAgentPodStatus, (state, action) => {
      state.agentPodStatuses = state.agentPodStatuses.filter(s => s.agentId !== action.payload);
    })
    .addCase(setConfigMapResourceVersion, (state, action) => {
      state.configMapResourceVersion = action.payload;
    })
    .addDefaultCase(state => state),
);

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function parseRetryAfter(response: Response): Promise<number> {
  const header = response.headers.get('Retry-After');
  if (header) {
    const seconds = parseInt(header, 10);
    if (!isNaN(seconds)) {
      return seconds * 1000;
    }
  }
  try {
    const body = (await response.clone().json()) as { message?: string };
    const match = body.message?.match(REGEX_RETRY_IN);
    if (match) {
      return parseInt(match[1], 10) * 1000;
    }
  } catch {
    // ignore
  }
  return 10_000;
}

export const clearAgentTerminalUrl = (): AppThunk => async dispatch => {
  dispatch(setAgentTerminalUrl(undefined));
};

function isAgentPodStatus(value: unknown): value is AgentPodStatus {
  return (
    typeof value === 'object' &&
    value !== null &&
    'agentId' in value &&
    'phase' in value &&
    'ready' in value
  );
}

const AGENT_LABEL_COMPONENT = 'app.kubernetes.io/component';

class WebSocketListenerRegistry {
  private configMapListener: ChannelListener | undefined;
  private agentPodListener: ChannelListener | undefined;

  isConfigMapListenerActive(): boolean {
    return this.configMapListener !== undefined;
  }
  isAgentPodListenerActive(): boolean {
    return this.agentPodListener !== undefined;
  }
  setConfigMapListener(l: ChannelListener | undefined): void {
    this.configMapListener = l;
  }
  setAgentPodListener(l: ChannelListener | undefined): void {
    this.agentPodListener = l;
  }
  getConfigMapListener(): ChannelListener | undefined {
    return this.configMapListener;
  }
  getAgentPodListener(): ChannelListener | undefined {
    return this.agentPodListener;
  }
}
const wsListeners = new WebSocketListenerRegistry();

function handleAgentPodWebSocketMessage(
  dispatch: (action: unknown) => void,
  message: api.webSocket.NotificationMessage,
): void {
  if (!api.webSocket.isPodMessage(message)) return;

  const { pod, eventPhase } = message;
  const labels = pod.metadata?.labels || {};
  if (labels[AGENT_LABEL_COMPONENT] !== 'ai-agent') return;

  const podAgentId = pod.metadata?.annotations?.['che.eclipse.org/ai-agent-id'] || '';

  if (eventPhase === api.webSocket.EventPhase.DELETED || pod.metadata?.deletionTimestamp) {
    dispatch(removeAgentPodStatus(podAgentId));
    return;
  }

  const phase = (pod.status?.phase as AgentPodPhase) || AgentPodPhase.UNKNOWN;

  if (phase === AgentPodPhase.SUCCEEDED || phase === AgentPodPhase.FAILED) {
    dispatch(removeAgentPodStatus(podAgentId));
    return;
  }

  const containerReady = pod.status?.containerStatuses?.some(c => c.ready === true) || false;

  dispatch(
    upsertAgentPodStatus({
      agentId: podAgentId,
      name: pod.metadata?.name || '',
      phase,
      ready: phase === AgentPodPhase.RUNNING && containerReady,
      serviceUrl: undefined,
    }),
  );
}

const MODIFIED_ANNOTATION_PREFIX = 'che.eclipse.org/modified-';

function handleConfigMapWebSocketMessage(
  dispatch: (action: unknown) => void,
  message: api.webSocket.NotificationMessage,
): void {
  if (api.webSocket.isConfigMapMessage(message)) {
    const { configMap } = message;
    const resourceVersion = configMap.metadata?.resourceVersion;
    if (resourceVersion) {
      dispatch(setConfigMapResourceVersion(resourceVersion));
    }
    const devfiles = parseConfigMapData(configMap.data, configMap.metadata?.annotations);
    dispatch(requestSuccess(devfiles));
  }
}

function parseConfigMapData(
  data: Record<string, string> | undefined,
  annotations?: Record<string, string>,
): LocalDevfile[] {
  if (!data) return [];
  return Object.entries(data).map(([id, content]) => {
    const storedTimestamp = annotations?.[`${MODIFIED_ANNOTATION_PREFIX}${id}`];
    return {
      id,
      name: extractName(content),
      description: extractDescription(content),
      content,
      projectNames: extractProjectNames(content),
      lastModified: storedTimestamp || new Date().toISOString(),
    };
  });
}

export const actionCreators = {
  requestDevfiles: (): AppThunk => async (dispatch, getState) => {
    dispatch(requestStart());
    try {
      const namespace = selectDefaultNamespace(getState()).name;
      const response = await fetch(`${DEVFILES_API_BASE}/${namespace}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch devfiles: ${response.statusText}`);
      }
      const data = (await response.json()) as { devfiles: LocalDevfile[] };
      const devfiles = data.devfiles.map(d => ({
        ...d,
        projectNames: d.content ? extractProjectNames(d.content) : [],
      }));
      dispatch(requestSuccess(devfiles));
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      dispatch(requestError(message));
    }
  },

  createDevfile:
    (name: string, description: string, content: string): AppThunk<Promise<string>> =>
    async (dispatch, getState) => {
      const namespace = selectDefaultNamespace(getState()).name;
      const response = await fetch(`${DEVFILES_API_BASE}/${namespace}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (!response.ok) {
        throw new Error(`Failed to create devfile: ${response.statusText}`);
      }
      const data = (await response.json()) as { id: string };
      dispatch(
        addDevfile({
          id: data.id,
          name,
          description,
          content,
          projectNames: extractProjectNames(content),
          lastModified: new Date().toISOString(),
        }),
      );
      return data.id;
    },

  saveDevfile:
    (id: string, content: string): AppThunk =>
    async (dispatch, getState) => {
      dispatch(requestStart());
      try {
        const namespace = selectDefaultNamespace(getState()).name;
        const response = await fetch(`${DEVFILES_API_BASE}/${namespace}/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content }),
        });
        if (!response.ok) {
          throw new Error(`Failed to save devfile: ${response.statusText}`);
        }
        const devfiles = getState().localDevfiles.devfiles.map(d =>
          d.id === id
            ? {
                ...d,
                name: extractName(content),
                description: extractDescription(content),
                content,
                projectNames: extractProjectNames(content),
                lastModified: new Date().toISOString(),
              }
            : d,
        );
        dispatch(requestSuccess(devfiles));
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Failed to save devfile';
        dispatch(requestError(message));
        throw e;
      }
    },

  deleteDevfile:
    (id: string): AppThunk =>
    async (dispatch, getState) => {
      const namespace = selectDefaultNamespace(getState()).name;
      const response = await fetch(`${DEVFILES_API_BASE}/${namespace}/${id}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        throw new Error(`Failed to delete devfile: ${response.statusText}`);
      }
      dispatch(removeDevfile(id));
    },

  startAgent:
    (agent: api.AiAgentDefinition, instanceId?: string): AppThunk =>
    async (dispatch, getState) => {
      const namespace = selectDefaultNamespace(getState()).name;
      const agentId = instanceId || agent.id;

      dispatch(
        upsertAgentPodStatus({
          agentId,
          name: '',
          phase: AgentPodPhase.PENDING,
          ready: false,
          serviceUrl: undefined,
        }),
      );

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        const response = await fetch(`${AGENTS_API_BASE}/${namespace}/agent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId,
            image: agent.image,
            tag: agent.tag,
            memoryLimit: agent.memoryLimit,
            cpuLimit: agent.cpuLimit,
            terminalPort: agent.terminalPort,
            env: agent.env,
          }),
        });

        if (response.status === HTTP_TOO_MANY_REQUESTS && attempt < MAX_RETRIES) {
          const retryAfter = await parseRetryAfter(response);
          await delay(retryAfter);
          continue;
        }

        if (!response.ok) {
          const text = await response.text();
          dispatch(removeAgentPodStatus(agentId));
          throw new Error(`Failed to start agent: ${text}`);
        }

        const rawStatus: unknown = await response.json();
        if (!isAgentPodStatus(rawStatus)) {
          throw new Error('Unexpected API response shape');
        }
        dispatch(upsertAgentPodStatus(rawStatus));
        return;
      }
    },

  stopAgent:
    (agentId: string): AppThunk =>
    async (dispatch, getState) => {
      const namespace = selectDefaultNamespace(getState()).name;
      dispatch(setAgentTerminalUrl(undefined));
      dispatch(removeAgentPodStatus(agentId));

      try {
        await fetch(`${AGENTS_API_BASE}/${namespace}/agent/${encodeURIComponent(agentId)}`, {
          method: 'DELETE',
        });
      } catch {
        // Best-effort cleanup
      }
    },

  fetchAgentStatus:
    (agentId: string, terminalPort = DEFAULT_TERMINAL_PORT): AppThunk =>
    async (dispatch, getState) => {
      try {
        const namespace = selectDefaultNamespace(getState()).name;
        const params = new URLSearchParams({ terminalPort: String(terminalPort) });
        const response = await fetch(
          `${AGENTS_API_BASE}/${namespace}/agent/${encodeURIComponent(agentId)}?${params.toString()}`,
        );
        if (!response.ok) {
          return;
        }
        const rawStatus: unknown = await response.json();
        if (!isAgentPodStatus(rawStatus)) {
          throw new Error('Unexpected API response shape');
        }
        dispatch(upsertAgentPodStatus(rawStatus));
      } catch {
        // network error — keep current status
      }
    },

  sendHeartbeat:
    (agentId: string): AppThunk =>
    async (_dispatch, getState) => {
      const namespace = selectDefaultNamespace(getState()).name;
      const response = await fetch(
        `${AGENTS_API_BASE}/${namespace}/agent/${encodeURIComponent(agentId)}/heartbeat`,
        { method: 'POST' },
      );
      if (!response.ok) {
        throw new Error(`Heartbeat failed: ${response.status}`);
      }
    },

  fetchAgentTerminalUrl:
    (agentId = 'anthropic/claude-code', terminalPort = DEFAULT_TERMINAL_PORT): AppThunk =>
    async (dispatch, getState) => {
      const namespace = selectDefaultNamespace(getState()).name;
      const params = new URLSearchParams({
        agentId,
        terminalPort: String(terminalPort),
      });
      const response = await fetch(
        `${AGENTS_API_BASE}/${namespace}/agent-terminal-url?${params.toString()}`,
      );
      if (!response.ok) {
        dispatch(setAgentTerminalUrl(undefined));
        throw new Error(`Terminal URL fetch failed: ${response.status}`);
      }
      const terminalUrl = `${AGENTS_API_BASE}/${namespace}/agent/t/?${params.toString()}`;
      dispatch(setAgentTerminalUrl(terminalUrl));
    },

  subscribeToConfigMapChanges: (): AppThunk => async (dispatch, getState) => {
    if (wsListeners.isConfigMapListenerActive()) return;

    const websocketClient = container.get(WebsocketClient);
    const namespace = selectDefaultNamespace(getState()).name;

    const listener: ChannelListener = message => {
      handleConfigMapWebSocketMessage(dispatch, message);
    };
    websocketClient.addChannelMessageListener(api.webSocket.Channel.CONFIGMAP, listener);
    wsListeners.setConfigMapListener(listener);

    const resourceVersion = getState().localDevfiles.configMapResourceVersion;
    websocketClient.subscribeToChannel(api.webSocket.Channel.CONFIGMAP, namespace, {
      getResourceVersion: () => resourceVersion || '',
    });
  },

  unsubscribeFromConfigMapChanges: (): AppThunk => async () => {
    if (!wsListeners.isConfigMapListenerActive()) return;

    const websocketClient = container.get(WebsocketClient);
    websocketClient.removeChannelMessageListener(
      api.webSocket.Channel.CONFIGMAP,
      wsListeners.getConfigMapListener()!,
    );
    websocketClient.unsubscribeFromChannel(api.webSocket.Channel.CONFIGMAP);
    wsListeners.setConfigMapListener(undefined);
  },

  subscribeToAgentPodChanges: (): AppThunk => async (dispatch, getState) => {
    if (wsListeners.isAgentPodListenerActive()) return;

    const websocketClient = container.get(WebsocketClient);

    const listener: ChannelListener = message => {
      handleAgentPodWebSocketMessage(dispatch, message);
    };
    websocketClient.addChannelMessageListener(api.webSocket.Channel.POD, listener);
    wsListeners.setAgentPodListener(listener);

    const pods = getState().pods.pods;
    for (const pod of pods) {
      const labels = pod.metadata?.labels || {};
      if (labels[AGENT_LABEL_COMPONENT] !== 'ai-agent') continue;
      if (pod.metadata?.deletionTimestamp) continue;

      const phase = (pod.status?.phase as AgentPodPhase) || AgentPodPhase.UNKNOWN;
      if (phase === AgentPodPhase.SUCCEEDED || phase === AgentPodPhase.FAILED) continue;

      const agentId = pod.metadata?.annotations?.['che.eclipse.org/ai-agent-id'] || '';
      const containerReady = pod.status?.containerStatuses?.some(c => c.ready === true) || false;
      dispatch(
        upsertAgentPodStatus({
          agentId,
          name: pod.metadata?.name || '',
          phase,
          ready: phase === AgentPodPhase.RUNNING && containerReady,
          serviceUrl: undefined,
        }),
      );
    }
  },
};

function extractName(content: string): string {
  const nameMatch = content.match(REGEX_NAME);
  if (nameMatch) return nameMatch[1].trim();
  const generateNameMatch = content.match(REGEX_GENERATE_NAME);
  if (generateNameMatch) return generateNameMatch[1].trim();
  return 'untitled';
}

function extractDescription(content: string): string {
  const match = content.match(REGEX_DESCRIPTION);
  return match ? match[1].trim() : '';
}

interface DevfileYaml {
  projects?: Array<{ name?: string }>;
}

export function buildAgentWorkspaceName(agentId: string): string {
  return 'agent-' + agentId.replace(/\//g, '-').replace(/[^a-z0-9-]/g, '');
}

export function extractProjectNames(content: string): string[] {
  try {
    const parsed = load(content) as DevfileYaml | null;
    if (!parsed?.projects) return [];
    return parsed.projects
      .map(p => p.name)
      .filter((name): name is string => typeof name === 'string' && name.length > 0);
  } catch {
    return [];
  }
}
