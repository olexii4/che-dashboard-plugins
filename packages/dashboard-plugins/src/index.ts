/*
 * Copyright (c) 2018-2026 Red Hat, Inc.
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 *
 * Contributors:
 *   Red Hat, Inc. - initial API and implementation
 */

import { ComponentType, ReactNode } from 'react';
import { Reducer, Store } from 'redux';

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  enabled: boolean;
}

export interface NavigationItemDefinition {
  to: string;
  label: string;
  labelSelector?: (state: unknown) => string;
  insertAfter?: string;
}

export interface LoaderTabDefinition {
  key: string;
  title: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component: ComponentType<{ workspace: unknown; isActive: boolean }>;
  insertAfter?: string;
}

export interface TabDefinition {
  name: string;
  key: string;
  component: ComponentType;
  visible?: (state: unknown) => boolean;
}

export interface ColumnDefinition {
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component: ComponentType<any>;
  visible?: (state: unknown) => boolean;
}

export interface FactoryParamExtension {
  paramName: string;
  parse: (value: string) => string[];
}

export interface PluginSlots {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  workspaceCreation?: ComponentType<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  workspaceDetailsOverview?: ComponentType<any>;
  workspacesListColumn?: ColumnDefinition;
  userPreferencesTab?: TabDefinition;
  factoryParams?: FactoryParamExtension;
  navigationItems?: NavigationItemDefinition[];
  loaderTabs?: LoaderTabDefinition[];
}

export interface WorkspaceHooks {
  onWorkspaceCreate?: (
    workspace: Record<string, unknown>,
    factoryParams: Record<string, unknown>,
  ) => Record<string, unknown>;
  onWorkspaceStart?: (
    workspace: Record<string, unknown>,
  ) => Record<string, unknown> | null;
}

export interface FrontendPlugin {
  manifest: PluginManifest;
  reducerKey: string;
  reducer: Reducer;
  bootstrap?: (store: Store) => Promise<void>;
  slots: PluginSlots;
  workspaceHooks?: WorkspaceHooks;
}

export interface PluginSlotProps {
  name: keyof PluginSlots;
  props?: Record<string, unknown>;
  children?: ReactNode;
}

// Runtime registry — minimal shim used when running plugin tests standalone.
const frontendPlugins: FrontendPlugin[] = [];

export function registerFrontendPlugin(plugin: FrontendPlugin): void {
  if (!plugin.manifest.enabled) return;
  frontendPlugins.push(plugin);
}

export function getRegisteredFrontendPlugins(): FrontendPlugin[] {
  return [...frontendPlugins];
}

export function getPluginNavigationItems(): NavigationItemDefinition[] {
  return frontendPlugins.flatMap(p => p.slots.navigationItems ?? []);
}

export function getPluginLoaderTabs(): LoaderTabDefinition[] {
  return frontendPlugins.flatMap(p => p.slots.loaderTabs ?? []);
}
