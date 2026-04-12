import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir:              '.',
  testRegex:            'test/unit/.*\\.spec\\.ts$',
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
  testTimeout: 15_000,
};

export default config;
