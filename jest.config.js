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

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'jsdom',
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', {
      tsconfig: {
        jsx: 'react',
        esModuleInterop: true,
        noImplicitAny: false,
        skipLibCheck: true,
      },
    }],
  },
  moduleNameMapper: {
    // Map @/ imports to the stubs package for standalone testing.
    // Individual test files can override specific @/ paths with jest.mock().
    '^@/(.*)$': '<rootDir>/packages/stubs/src/dashboard.d.ts',
    // CSS modules
    '\\.module\\.css$': '<rootDir>/packages/stubs/src/styleMock.js',
    '\\.css$': '<rootDir>/packages/stubs/src/styleMock.js',
  },
  setupFilesAfterFramework: ['@testing-library/jest-dom/extend-expect'],
  testPathIgnorePatterns: ['/node_modules/', '/lib/'],
  collectCoverageFrom: [
    '{ai-selector,dashboard-ai-agent}/{frontend,backend}/**/*.{ts,tsx}',
    '!**/*.spec.{ts,tsx}',
    '!**/__mocks__/**',
    '!**/lib/**',
  ],
};
