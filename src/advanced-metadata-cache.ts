/**
 * @file
 *
 * Reads when each of a note's headings was created, last modified and last seen, from the Advanced
 * Metadata Cache plugin (issue #306).
 *
 * Obsidian keeps no per-heading metadata, so `Reorder headings...` cannot sort by time on its own. Advanced
 * Metadata Cache's `Headings` module tracks those times and publishes them in the `obsidian-dev-utils`
 * plugin registry, which is where this plugin reads them, the same way it reaches Custom Attachment
 * Location (`custom-attachment-location.ts`). That plugin is an Obsidian plugin repo rather than an npm
 * package, so there is nothing to depend on: its own copyable `api.d.ts` and `api-contract.ts` are copied
 * VERBATIM into `./advanced-metadata-cache-api/`, and everything here narrows them to the one member this
 * plugin calls. Refresh the copy from the provider's repository rather than editing it, so both ends keep
 * checking ONE definition. The other plugin is optional: not installed, disabled, older than contract
 * `1.2.0`, or with its `Headings` module off all read as "no times".
 */

import type { TypedApiContract } from '@mnaoumov/typescript-lib/api-contract';
import type {
  App,
  HeadingCache,
  TFile
} from 'obsidian';

import { watchPluginApi } from '@mnaoumov/obsidian-lib/plugin/plugin-api';
import { ensureNonNullable } from '@mnaoumov/typescript-lib/type-guards';
import { Component } from 'obsidian';

import type {
  AdvancedMetadataCacheApi as AdvancedMetadataCacheFullApi,
  HeadingTimes
} from './advanced-metadata-cache-api/api.d.ts';

import { ADVANCED_METADATA_CACHE_API_CONTRACT as ADVANCED_METADATA_CACHE_FULL_API_CONTRACT } from './advanced-metadata-cache-api/api-contract.ts';

export type { HeadingTimes } from './advanced-metadata-cache-api/api.d.ts';

/**
 * The `Advanced Metadata Cache` plugin's id, under which it publishes its API.
 */
export const ADVANCED_METADATA_CACHE_PLUGIN_ID = 'advanced-metadata-cache';

/**
 * The contract version range this plugin compiled against. `getHeadingTimes` was added in contract
 * `1.2.0`, first released in `Advanced Metadata Cache` `1.2.0`.
 */
export const ADVANCED_METADATA_CACHE_API_VERSION_RANGE = '^1.2.0';

/**
 * What this plugin calls, supplied to `watchPluginApi` as the consumer's own contract, so a future provider
 * that dropped the member is not mistaken for one that has it. The entry is the provider's own, schemas
 * included.
 */
export const ADVANCED_METADATA_CACHE_API_CONTRACT: TypedApiContract<AdvancedMetadataCacheApi> = {
  getHeadingTimes: ADVANCED_METADATA_CACHE_FULL_API_CONTRACT.getHeadingTimes
};

/**
 * `Advanced Metadata Cache`'s public API, as far as this plugin uses it.
 */
export type AdvancedMetadataCacheApi = Pick<AdvancedMetadataCacheFullApi, 'getHeadingTimes'>;

/**
 * Parameters for {@link readHeadingTimes}.
 */
export interface ReadHeadingTimesParams {
  readonly app: App;
  readonly file: TFile;

  /**
   * The headings the caller works on, from the metadata cache. The answer is aligned to them.
   */
  readonly headings: readonly HeadingCache[];
}

/**
 * Reads the times of a note's headings, aligned to the headings the caller works on.
 *
 * The answer is used only when it describes exactly those headings: the same number, each on the same line
 * with the same text. Otherwise it was taken from another parse of the note, and indexing it by position
 * would attach one heading's times to another, so it is not used at all.
 *
 * @param params - The parameters.
 * @returns One entry per heading, in the same order, or `null` when no times are available for these
 *   headings.
 */
export function readHeadingTimes(params: ReadHeadingTimesParams): HeadingTimes[] | null {
  const { headings } = params;
  if (headings.length === 0) {
    return null;
  }

  const component = new Component();
  component.load();
  try {
    const api = watchPluginApi<AdvancedMetadataCacheApi>({
      apiVersionRange: ADVANCED_METADATA_CACHE_API_VERSION_RANGE,
      app: params.app,
      component,
      contract: ADVANCED_METADATA_CACHE_API_CONTRACT,
      pluginId: ADVANCED_METADATA_CACHE_PLUGIN_ID
    }).value;
    if (api === null) {
      return null;
    }

    const times = api.getHeadingTimes(params.file);
    const isAligned = times.length === headings.length
      && times.every((entry, index) => {
        // The lengths are equal, so every index has a heading.
        const heading = ensureNonNullable(headings[index]);
        return entry.line === heading.position.start.line && entry.heading === heading.heading;
      });
    return isAligned ? times : null;
  } finally {
    component.unload();
  }
}
