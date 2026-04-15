import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir:              '.',
  testRegex:            'test/e2e/.*\\.e2e-spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  // @pdfme/* est distribué en ESM uniquement — ts-jest doit les transformer
  // (sinon le runtime CommonJS de Jest jette "Cannot use import statement outside a module").
  transformIgnorePatterns: ['node_modules/(?!(@pdfme)/)'],
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  globalSetup:    './test/helpers/global-setup.ts',
  globalTeardown: './test/helpers/global-teardown.ts',
  testTimeout: 30_000,
};

export default config;
