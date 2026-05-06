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

import {
  AGENT_LABEL_AGENT_ID,
  AGENT_LABEL_COMPONENT,
  AGENT_LABEL_PART_OF,
} from './agentPodConstants';

/**
 * Normalizes an agentId to a value that is safe for use in Kubernetes resource
 * names and label values: lowercase, slashes replaced with hyphens, all other
 * characters that are not lowercase alphanumeric or hyphen removed.
 */
export function normalizeAgentId(agentId: string): string {
  return agentId
    .toLowerCase()
    .replace(/\//g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

/**
 * Returns true when a pod phase represents a terminal (non-restartable) state,
 * i.e. the pod has finished execution either successfully or with an error.
 */
export function isTerminalPhase(phase: string): boolean {
  return phase === 'Failed' || phase === 'Succeeded';
}

/** Derives the pod name for a given agentId. */
export function agentPodName(agentId: string): string {
  return `agent-${normalizeAgentId(agentId)}`;
}

/** Derives the ClusterIP service name for a given agentId. */
export function agentServiceName(agentId: string): string {
  return `agent-${normalizeAgentId(agentId)}-svc`;
}

/** Derives the token secret name for a given agentId. */
export function agentTokenSecretName(agentId: string): string {
  return `agent-${normalizeAgentId(agentId)}-token`;
}

/** Builds the standard set of Kubernetes labels applied to every agent resource. */
export function agentLabels(agentId: string): Record<string, string> {
  return {
    [AGENT_LABEL_COMPONENT]: 'ai-agent',
    [AGENT_LABEL_PART_OF]: 'che.eclipse.org',
    [AGENT_LABEL_AGENT_ID]: normalizeAgentId(agentId),
  };
}
