import type { Config } from 'jest';

/**
 * Jest config pour les tests d'intégration Testcontainers.
 *
 * - runInBand : une seule connexion DB à la fois (pas de races sur le container)
 * - globalSetup/globalTeardown : cycle de vie du container PostgreSQL
 * - testTimeout 60s : démarrage du container peut prendre ~15s
 * - moduleNameMapper : mêmes alias que jest.unit.config.ts
 */
const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir:              '.',
  testRegex:            'test/integration/.*(-spec|\\.spec)\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@/(.*)$':        '<rootDir>/src/$1',
    '^@core/(.*)$':    '<rootDir>/src/core/$1',
    '^@infra/(.*)$':   '<rootDir>/src/infrastructure/$1',
    '^@modules/(.*)$': '<rootDir>/src/modules/$1',
    '^@common/(.*)$':  '<rootDir>/src/common/$1',
  },
  globalSetup:    './test/integration/setup/db.setup.ts',
  globalTeardown: './test/integration/setup/db.teardown.ts',
  testTimeout:    60_000,
};

export default config;
