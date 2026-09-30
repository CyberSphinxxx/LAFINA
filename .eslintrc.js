module.exports = {
  root: true,
  extends: '@react-native',
  overrides: [
    {
      // Jest's setup file and manual mocks run under Jest and Node, not React Native.
      files: ['jest.setup.js', 'jest.config.js', '__mocks__/**/*.js'],
      env: { jest: true, node: true, es2021: true },
    },
  ],
};
