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
 * Everything here is defensive. The other plugin is optional: the user may not have it installed, may
 * have disabled it, or may be running a version from before it exposed this.
 */

import type {
  App,
  TAbstractFile
} from 'obsidian';

/**
 * The Custom Attachment Location plugin's id, as it appears in `app.plugins`.
 */
export const CUSTOM_ATTACHMENT_LOCATION_PLUGIN_ID = 'obsidian-custom-attachment-location';

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
 * The slice of the Custom Attachment Location plugin this plugin uses.
 */
interface CustomAttachmentLocationPluginLike {
  collectAttachmentsInAbstractFiles(abstractFiles: TAbstractFile[]): void;
}

/**
 * Whether the Custom Attachment Location plugin is installed, enabled, and new enough to expose the
 * entry point {@link collectAttachmentsWithCustomAttachmentLocation} uses.
 *
 * @param app - The Obsidian application instance.
 * @returns `true` when it can be asked, `false` otherwise.
 */
export function checkIsCustomAttachmentLocationAvailable(app: App): boolean {
  return findCustomAttachmentLocationPlugin(app) !== null;
}

/**
 * Asks the Custom Attachment Location plugin to collect the given notes' attachments.
 *
 * Does nothing when that plugin is absent, disabled, or too old to expose the entry point, so a user
 * without it sees no change and no error. Use {@link checkIsCustomAttachmentLocationAvailable} to tell
 * the two apart.
 *
 * @param params - The parameters.
 */
export function collectAttachmentsWithCustomAttachmentLocation(params: CollectAttachmentsWithCustomAttachmentLocationParams): void {
  if (params.abstractFiles.length === 0) {
    return;
  }

  const plugin = findCustomAttachmentLocationPlugin(params.app);
  plugin?.collectAttachmentsInAbstractFiles([...params.abstractFiles]);
}

function findCustomAttachmentLocationPlugin(app: App): CustomAttachmentLocationPluginLike | null {
  const plugin: unknown = app.plugins.getPlugin(CUSTOM_ATTACHMENT_LOCATION_PLUGIN_ID);
  if (plugin === null || typeof plugin !== 'object') {
    return null;
  }

  // Checked rather than assumed: the entry point was added in a later version than the plugin itself,
  // So a user can perfectly well have the plugin without having the method.
  const candidate = plugin as Partial<CustomAttachmentLocationPluginLike>;
  if (typeof candidate.collectAttachmentsInAbstractFiles !== 'function') {
    return null;
  }

  return candidate as CustomAttachmentLocationPluginLike;
}
