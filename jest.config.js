module.exports = {
  preset: '@react-native/jest-preset',
  setupFiles: ['./jest.setup.js'],
  // React Native screen suites render real components against the SQLite harness.
  // Under the default parallel worker pool a single heavy case can exceed Jest's
  // 5s default budget and fail nondeterministically, so give the suite headroom.
  testTimeout: 20000,
  moduleNameMapper: {
    '\\.(gguf|bin|onnx)$': '<rootDir>/__mocks__/fileMock.js',
  },
};
