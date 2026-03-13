/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/__tests__"],
  moduleNameMapper: {
    "^@elgato/streamdeck$": "<rootDir>/__mocks__/@elgato/streamdeck.ts",
    // Resolve TypeScript .js extension imports (ESM-style) in Jest/CJS environment
    "^(\\.{1,2}/.*)\\.js$": "$1"
  },
  collectCoverageFrom: ["src/**/*.ts"],
  coverageDirectory: "coverage",
  testTimeout: 10000
};
