/**
 * @file
 *
 * Hands a note to the Custom Attachment Location plugin so it can collect that note's attachments.
 *
 * This plugin already moves the attachments an extracted range references, but only when the range is
 * their SOLE referencer — an attachment also referenced from elsewhere stays where it is, because
 * deciding where a shared attachment belongs is a question this plugin has no answer to. Custom
 * Attachment Location does: it has a whole setting for it, and a priority list on top. So rather than
 * grow a second, worse copy of that logic here, the destination note is handed over and the other
 * plugin decides (issue #246).
 *
 * The other plugin is reached through the API it publishes in the `obsidian-dev-utils` plugin registry,
 * not through its plugin instance. That plugin is an Obsidian plugin repo rather than an npm package, so
 * there is nothing to depend on: the shape below is this plugin's compiled-against copy of the one member
 * it calls, taken from that repo's own copyable `api.d.ts`, and `watchPluginApi` negotiates the version at
 * runtime. The other plugin is optional — not installed, disabled, or older than contract `1.2.0` all read
 * as "not available".
 */

import type {
  App,
  TAbstractFile
} from 'obsidian';
import type { PluginApiContract } from 'obsidian-dev-utils/obsidian/plugin/plugin-api';

import { Component } from 'obsidian';
import { noopAsync } from 'obsidian-dev-utils/function';
import { watchPluginApi } from 'obsidian-dev-utils/obsidian/plugin/plugin-api';

/**
 * The Custom Attachment Location plugin's id, under which it publishes its API.
 */
export const CUSTOM_ATTACHMENT_LOCATION_PLUGIN_ID = 'obsidian-custom-attachment-location';

/**
 * The contract version range this plugin compiled against. `collectAttachments` was added in contract
 * `1.2.0`, first released in Custom Attachment Location `13.0.0`.
 */
export const CUSTOM_ATTACHMENT_LOCATION_API_VERSION_RANGE = '^1.2.0';

/**
 * What this plugin calls, supplied to `watchPluginApi` as the consumer's own contract. Without it the shape
 * check would use the provider's contract, which a future provider could satisfy while dropping this member.
 */
export const CUSTOM_ATTACHMENT_LOCATION_API_CONTRACT: PluginApiContract = {
  collectAttachments: {}
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
 * Custom Attachment Location's public API, as far as this plugin uses it.
 */
export interface CustomAttachmentLocationApi {
  /**
   * Collects the attachments of the given notes, or of every note under the given folders, into the folders
   * the settings say they belong in — exactly as the `Collect attachments` commands do, dialogs included.
   *
   * @param params - What to collect.
   * @returns A promise that settles once the collect has finished.
   */
  collectAttachments: (params: CollectAttachmentsParams) => Promise<void>;
}

/**
 * Parameters for {@link CustomAttachmentLocationApi.collectAttachments}.
 */
interface CollectAttachmentsParams {
  /**
   * The notes to collect for, and folders whose notes are all collected for.
   */
  readonly pathsOrFiles: readonly (string | TAbstractFile)[];
}

/**
 * Asks the Custom Attachment Location plugin to collect the given notes' attachments.
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
