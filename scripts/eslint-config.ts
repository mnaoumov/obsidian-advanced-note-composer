import type { Linter } from 'eslint';
import type { EslintConfigContext } from 'obsidian-dev-utils/script-utils/linters/eslint-config';

import { defineEslintConfigs } from 'obsidian-dev-utils/script-utils/linters/eslint-config';

export const configs = defineEslintConfigs({
  customConfigs(context: EslintConfigContext): Linter.Config[] {
    return [
      {
        files: context.testFiles,
        rules: {
          '@typescript-eslint/explicit-function-return-type': 'off',
          'no-restricted-syntax': [
            'error',
            {
              message: 'Do not use definite assignment assertions (!). Initialize the field or make it optional.',
              selector: 'PropertyDefinition[definite=true]'
            },
            {
              message: 'Do not use definite assignment assertions (!) on abstract fields.',
              selector: 'TSAbstractPropertyDefinition[definite=true]'
            },
            {
              message: 'Do not use _ prefix on methods or functions. The _ prefix is for unused parameters only.',
              selector: 'MethodDefinition[key.name=/^_/]:not([override=true])'
            },
            {
              message: 'Do not use _ prefix on methods or functions. The _ prefix is for unused parameters only.',
              selector: 'FunctionDeclaration[id.name=/^_/]'
            },
            {
              message: 'Do not rename imports with "Mock" in the alias. Mock classes are the canonical types — use the original name.',
              selector: 'ImportSpecifier[local.name=/Mock/]:not([imported.name=/Mock/])'
            },
            {
              message: 'Avoid dynamic import(). Use static imports instead. Only use dynamic imports for lazy/conditional loading.',
              selector: 'ImportExpression'
            },
            {
              message: 'Do not use `declare` on class properties. Initialize the property or use a regular type annotation.',
              selector: 'PropertyDefinition[declare=true]'
            }
          ],
          'obsidianmd/no-tfile-tfolder-cast': 'off'
        }
      }
    ];
  }
});
