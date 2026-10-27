import type { Linter } from 'eslint';

import { defineEslintConfigs } from '@mnaoumov/obsidian-dev-toolkit/linters/eslint-config';
import {
  defineConfig,
  globalIgnores
} from 'eslint/config';

export const configs: Linter.Config[] = defineEslintConfigs({
  customConfigs() {
    return defineConfig(
      // Verbatim copies of the providers' hand-written `api.d.ts`, refreshed from their repositories rather than
      // Edited, so their style is the providers' to keep.
      globalIgnores([
        'src/integrations/advanced-metadata-cache-api/api.d.ts',
        'src/integrations/custom-attachment-location-api/api.d.ts'
      ])
    );
  }
});
