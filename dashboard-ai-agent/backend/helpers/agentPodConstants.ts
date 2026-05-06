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

// Kubernetes label keys used to identify and group agent pods.
export const AGENT_LABEL_COMPONENT = 'app.kubernetes.io/component';
export const AGENT_LABEL_PART_OF = 'app.kubernetes.io/part-of';
export const AGENT_LABEL_AGENT_ID = 'che.eclipse.org/agent-id';

// Annotation key storing the ISO-8601 timestamp of the most recent agent heartbeat.
export const HEARTBEAT_ANNOTATION = 'che.eclipse.org/last-heartbeat';

// How long (in minutes) an agent pod may go without a heartbeat before being cleaned up.
export const AGENT_TTL_MINUTES = 20;

// Maximum number of simultaneously running agent pods allowed per user namespace.
export const MAX_AGENT_PODS_PER_USER = 3;

// Name of the projected volume that carries the Che user bearer token into the agent container.
export const TOKEN_SECRET_VOLUME = 'che-user-token';

// Mount path inside the agent container where the token secret is projected.
export const TOKEN_MOUNT_PATH = '/var/run/secrets/che/token';

// HTTP status code returned when the per-user agent pod limit has been reached.
export const HTTP_TOO_MANY_REQUESTS = 429;

// Default resource requests for the agent container (limits are caller-supplied).
export const AGENT_DEFAULT_MEMORY_REQUEST = '128Mi';
export const AGENT_DEFAULT_CPU_REQUEST = '100m';

// How often (in milliseconds) the server-side periodic cleanup timer fires.
export const PERIODIC_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

// DevWorkspace controller labels / annotation keys used to discover mounts.
export const DW_MOUNT_LABEL = 'controller.devfile.io/mount-to-devworkspace';
export const DW_MOUNT_AS = 'controller.devfile.io/mount-as';
export const DW_MOUNT_PATH = 'controller.devfile.io/mount-path';

// Environment variable names that must not be forwarded from the agent config
// because the pod spec already sets them to controlled values.
export const BLOCKED_ENV_NAMES = new Set([
  'PATH',
  'HOME',
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'KUBERNETES_API_URL',
  'CHE_USER_TOKEN_FILE',
  'AGENT_NAMESPACE',
]);
