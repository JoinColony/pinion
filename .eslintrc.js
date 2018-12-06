module.exports = {
  env: {
    commonjs: true,
    es6: true,
  },
  extends: [
    '@colony/eslint-config-colony',
  ],
  overrides: [
    {
      files: 'src/__tests__/**/*.js',
      rules: {
        'no-param-reassign': 'off',
        'no-underscore-dangle': 'off',
        'max-len': 'off',
      },
    },
  ],
  rules: {
    'import/no-extraneous-dependencies': [
      'error',
      {
        devDependencies: [
          '**/*.test.js',
          './*.js',
        ],
      },
    ],
  },
};
