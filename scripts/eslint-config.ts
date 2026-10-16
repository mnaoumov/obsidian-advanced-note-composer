import type { Linter } from 'eslint';

import {
  defineConfig,
  globalIgnores
} from 'eslint/config';
import { defineEslintConfigs } from 'obsidian-dev-utils/script-utils/linters/eslint-config';

export const configs: Linter.Config[] = defineEslintConfigs({
  customConfigs() {
    return defineConfig(
      // Verbatim copies of the providers' hand-written `api.d.ts`, refreshed from their repositories rather than
      // Edited, so their style is the providers' to keep.
      globalIgnores([
        'src/advanced-metadata-cache-api/api.d.ts',
        'src/custom-attachment-location-api/api.d.ts'
      ])
    );
  }
});
