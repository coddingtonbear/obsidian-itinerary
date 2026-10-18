module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  setupFiles: ["<rootDir>/jest.setup.js"],
  testMatch: ["<rootDir>/src/**/*.test.ts"],
  moduleNameMapper: {
    "^src/(.*)": "<rootDir>/src/$1",
    "^obsidian$": "<rootDir>/mocks/obsidian.ts",
  },
  transform: {
    "\\.ts$": ["ts-jest", { tsconfig: "tsconfig.test.json" }],
  },
};
