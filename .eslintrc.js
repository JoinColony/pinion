module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2018,
    sourceType: 'module',
  },
  env: {
    commonjs: true,
    es6: true,
  },
  extends: [
    'plugin:@typescript-eslint/recommended',
    'prettier/@typescript-eslint',
    'plugin:prettier/recommended',
  ],
  rules: {
    '@typescript-eslint/indent': ['error', 2],
    '@typescript-eslint/explicit-member-accessibility': ['error', {
      accessibility: 'explicit',
      overrides: {
        accessors: 'explicit',
        constructors: 'no-public',
        methods: 'explicit',
        properties: 'off',
        parameterProperties: 'explicit'
      }
    }],
    'max-len': [
      'error',
      {
        ignorePattern: '^import [^,]+ from |^export | implements',
        ignoreComments: true,
        ignoreStrings: true,
        ignoreTemplateLiterals: true,
        ignoreRegExpLiterals: true,
      },
    ],
    'no-warning-comments': ['error', {
      terms: ['@fixme', 'fixme'],
      location: 'anywhere',
    }],
  },
  overrides: [
    {
      files: ['*.test.ts'],
      rules: {
        '@typescript-eslint/explicit-function-return-type': 'off'
      }
    }
  ]
};
