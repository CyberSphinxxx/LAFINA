module.exports = {
  preset: '@react-native/jest-preset',
  setupFiles: ['./jest.setup.js'],
  // Agent worktrees under .kilo/ carry their own copies of the manual mocks;
  // an old op-sqlite mock there loads better-sqlite3, which aborts Node 24.
  modulePathIgnorePatterns: ['<rootDir>/.kilo/'],
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/.kilo/'],
  moduleNameMapper: {
    '\\.(gguf|bin|onnx)$': '<rootDir>/__mocks__/fileMock.js',
    '^@op-engineering/op-sqlite$': '<rootDir>/__mocks__/opSqliteMock.js',
  },
};
