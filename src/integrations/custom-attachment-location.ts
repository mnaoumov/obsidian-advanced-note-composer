/**
 * @file
 *
 * Hands a note to the `Custom Attachment Location` plugin so it can collect that note's attachments.
 *
 * This plugin already moves the attachments an extracted range references, but only when the range is
 * their SOLE referencer — an attachment also referenced from elsewhere stays where it is, because
 * deciding where a shared attachment belongs is a question this plugin has no answer to. Custom
 * Attachment Location does: it has a whole setting for it, and a priority list on top. So rather than
 * grow a second, worse copy of that logic here, the destination note is handed over and the other
 * plugin decides (issue #246).
 *
 * The other plugin is reached through the API it publishes in the `@mnaoumov/obsidian-lib` plugin registry,
 * not through its plugin instance. That plugin is an Obsidian plugin repo rather than an npm package, so
 * there is nothing to depend on: its own copyable `api.d.ts` and `api-contract.ts` are copied VERBATIM into
 * `./custom-attachment-location-api/`, everything here narrows them to the one member this plugin calls, and
 * `watchPluginApi` negotiates the version at runtime. Refresh the copy from the provider's repository rather
 * than editing it, so both ends keep checking ONE definition. The other plugin is optional — not installed,
 * disabled, or older than contract `1.2.0` all read as "not available".
 */

import type { TypedApiContract } from '@mnaoumov/typescript-lib/api-contract';
import type {
  App,
  TAbstractFile
} from 'obsidian';

import { watchPluginApi } from '@mnaoumov/obsidian-lib/plugin/plugin-api';
import { noopAsync } from '@mnaoumov/typescript-lib/function';
import { Component } from 'obsidian';

import type { CustomAttachmentLocationApi as CustomAttachmentLocationFullApi } from './custom-attachment-location-api/api.d.ts';

import { CUSTOM_ATTACHMENT_LOCATION_API_CONTRACT as CUSTOM_ATTACHMENT_LOCATION_FULL_API_CONTRACT } from './custom-attachment-location-api/api-contract.ts';

/**
 * The `Custom Attachment Location` plugin's id, under which it publishes its API.
 */
export const CUSTOM_ATTACHMENT_LOCATION_PLUGIN_ID = 'obsidian-custom-attachment-location';

/**
 * The contract version range this plugin compiled against. `collectAttachments` was added in contract
 * `1.2.0`, first released in `Custom Attachment Location` `13.0.0`.
 */
export const CUSTOM_ATTACHMENT_LOCATION_API_VERSION_RANGE = '^1.2.0';

/**
 * What this plugin calls, supplied to `watchPluginApi` as the consumer's own contract. Without it the shape
 * check would use the provider's contract, which a future provider could satisfy while dropping this member.
 * The entry is the provider's own, schemas included.
 */
export const CUSTOM_ATTACHMENT_LOCATION_API_CONTRACT: TypedApiContract<CustomAttachmentLocationApi> = {
  collectAttachments: CUSTOM_ATTACHMENT_LOCATION_FULL_API_CONTRACT.collectAttachments
};

/**
 * Parameters for {@link collectAttachmentsWithCustomAttachmentLocation}.
 */
export interface CollectAttachmentsWithCustomAttachmentLocationParams {
  /**
   * The notes whose attachments should be collected.
   */
  readonly abstractFiles: readonly TAbstractFile[];

  /**
   * The Obsidian application instance.
   */
  readonly app: App;
}

/**
 * `Custom Attachment Location`'s public API, as far as this plugin uses it.
 */
export type CustomAttachmentLocationApi = Pick<CustomAttachmentLocationFullApi, 'collectAttachments'>;

/**
 * Asks the `Custom Attachment Location` plugin to collect the given notes' attachments.
 *
 * The API is watched through a component that lives exactly as long as the call. `watchPluginApi` resolves
 * the published record synchronously, so the handle is current the moment it is returned, and the component
 * is unloaded once the collect settles — nothing is held between splits.
 *
 * @param params - The parameters.
 * @returns A promise that settles once the collect has finished, or `null` when the other plugin is not
 *   installed, not enabled, or too old to publish `collectAttachments`. The collect may ask the user things (a
 *   shared attachment, a `${prompt}` token), so a caller that has nothing to do after it need not await it.
 */
export function collectAttachmentsWithCustomAttachmentLocation(params: CollectAttachmentsWithCustomAttachmentLocationParams): null | Promise<void> {
  if (params.abstractFiles.length === 0) {
    return noopAsync();
  }

  const component = new Component();
  component.load();

  const api = watchPluginApi<CustomAttachmentLocationApi>({
    apiVersionRange: CUSTOM_ATTACHMENT_LOCATION_API_VERSION_RANGE,
    app: params.app,
    component,
    contract: CUSTOM_ATTACHMENT_LOCATION_API_CONTRACT,
    pluginId: CUSTOM_ATTACHMENT_LOCATION_PLUGIN_ID
  }).value;

  if (api === null) {
    component.unload();
    return null;
  }

  // A copy, so the other plugin cannot mutate an array this plugin still holds.
  const pathsOrFiles = [...params.abstractFiles];
  return (async (): Promise<void> => {
    try {
      await api.collectAttachments({ pathsOrFiles });
    } finally {
      component.unload();
    }
  })();
}
