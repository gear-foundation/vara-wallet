/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  // The @noble/* and @scure/* packages ship as ESM only; ts-jest needs to
  // transform them too. The default `transformIgnorePatterns` skips everything
  // in node_modules, so we narrow it to keep transforming those scopes.
  transformIgnorePatterns: ['node_modules/(?!(@noble|@scure)/)'],
  moduleNameMapper: {
    // Stub @vara-eth/api in unit tests — Phase 3a doesn't need a real api,
    // and bundling it through ts-jest pulls in viem (also ESM-only).
    '^@vara-eth/api$': '<rootDir>/src/__tests__/fixtures/vara-eth-api.stub.ts',
  },
};
