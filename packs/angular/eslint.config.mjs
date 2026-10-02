// @ts-check
import tseslint from 'typescript-eslint'
import angular from '@angular-eslint/eslint-plugin'
import angularTemplate from '@angular-eslint/eslint-plugin-template'
import angularTemplateParser from '@angular-eslint/template-parser'

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'server/**', '.angular/**', 'coverage/**']
  },
  {
    files: ['src/app/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: ['./tsconfig.json'],
        ecmaVersion: 2022,
        sourceType: 'module'
      }
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      '@angular-eslint': angular
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      quotes: ['error', 'single', { avoidEscape: true }],
      semi: ['error', 'never'],
      'no-unexpected-multiline': 'error'
    }
  },
  {
    files: ['src/app/**/*.html'],
    languageOptions: {
      parser: angularTemplateParser
    },
    plugins: {
      '@angular-eslint/template': angularTemplate
    },
    rules: {
      quotes: ['error', 'double', { avoidEscape: true }]
    }
  },
  {
    // Test files only: `any` is downgraded to a warning here because specs
    // routinely use it for mocks, spies, and partial stubs. This relaxation
    // applies to *.spec.ts exclusively — production source keeps `error`.
    files: ['src/app/**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn'
    }
  }
)
