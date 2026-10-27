import type { VaultTransaction } from '@mnaoumov/obsidian-lib/vault-transaction';
import type {
  App,
  TFile
} from 'obsidian';

import { isFile } from '@mnaoumov/obsidian-lib/file-system';
import { findPluginApi } from '@mnaoumov/obsidian-lib/plugin/plugin-api';
import {
  createApiContractSchemaBuilders,
  createExpectedTypeGuard,
  defineApiContract
} from '@mnaoumov/typescript-lib/api-contract';
import { isDeepEqual } from '@mnaoumov/typescript-lib/object-utils';
import { isUndefined } from '@mnaoumov/typescript-lib/type-guards';

import type { Frontmatter } from '../composers/frontmatter-merge.ts';
import type { PermanentLinksApi } from './permanent-links-api/api.d.ts';

import { extractFrontmatter } from '../composers/frontmatter-merge.ts';

const { createArgumentsSchema, createTypeGuardSchema } = createApiContractSchemaBuilders('permanent-links');
const FILE_GUARD = createExpectedTypeGuard('a file', isFile);

// The provider supplies a declaration but no runtime contract, so validate the one method we consume here.
const PERMANENT_LINKS_API_CONTRACT = defineApiContract<Pick<PermanentLinksApi, 'moveKeys'>>({
  moveKeys: {
    input: createArgumentsSchema([FILE_GUARD, FILE_GUARD]),
    output: createTypeGuardSchema(createExpectedTypeGuard('nothing', isUndefined))
  }
});

/**
 * Parameters for {@link movePermanentLinksKeys}.
 */
export interface MovePermanentLinksKeysParams {
  readonly app: App;
  readonly fromFile: TFile;
  readonly toFile: TFile;
  readonly vaultTransaction: VaultTransaction;
}

/**
 * Transfers a merged-away note's keys through the optional `Permanent Links` API.
 *
 * The provider publishes through `PluginBase.getPluginApis`. Its copyable declaration is kept verbatim
 * beside this consumer; refresh it from the provider rather than editing the copy. The consumer requires
 * `moveKeys`, introduced in contract 1.1.0. A missing, incompatible or disabled provider is a no-op.
 *
 * Both notes are captured before the API writes outside the transaction, so a rejected transfer or a later
 * failed merge restores their frontmatter. Call before reading the source content to merge: the provider
 * removes its keys there and preserves the destination's primary key and aliases.
 *
 * @param params - The notes and the merge's spanning transaction.
 * @returns The transfer promise, or `null` when unavailable. Its result contains the properties the API
 *   changed, to preserve in the ordinary frontmatter merge, including the replace strategy. Rejects on
 *   transfer failure, so the caller never deletes the source on failure.
 */
export function movePermanentLinksKeys(params: MovePermanentLinksKeysParams): null | Promise<Frontmatter> {
  const api = findPluginApi<Pick<PermanentLinksApi, 'moveKeys'>>({
    apiVersionRange: '^1.1.0',
    contract: PERMANENT_LINKS_API_CONTRACT,
    pluginId: 'permanent-links'
  });
  if (api === null) {
    return null;
  }

  return (async (): Promise<Frontmatter> => {
    await params.vaultTransaction.process(params.fromFile, (content) => content);
    await params.vaultTransaction.process(params.toFile, (content) => content);
    const original = extractFrontmatter(await params.app.vault.read(params.toFile)).frontmatter;
    await api.moveKeys(params.fromFile, params.toFile);
    const transferred = extractFrontmatter(await params.app.vault.read(params.toFile)).frontmatter;
    // Do not guess the provider's configurable key property name. Preserve exactly the properties it wrote,
    // including its accepted-key receipt, without preserving unrelated destination properties on Replace.
    const changedProperties = Object.entries(transferred).filter(([key, value]) => !isDeepEqual(original[key], value));
    return Object.fromEntries(changedProperties);
  })();
}
