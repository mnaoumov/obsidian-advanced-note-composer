/**
 * @file
 *
 * A stand-in `Custom Attachment Location`, for the unit tests that need an attachment-location plugin to own
 * the attachment resolution.
 *
 * `@mnaoumov/obsidian-lib` hands the resolution over exactly when that plugin publishes its attachment-path
 * API in the plugin registry, so this publishes one there, exactly as the plugin does. The registry lives on
 * the realm global, so every suite that publishes must call {@link revokeCustomAttachmentLocationStubs} after
 * each test, or a record left behind would answer the next one.
 */

import type { GetAvailablePathForAttachmentsExtendedFunctionParams } from '@mnaoumov/obsidian-lib/attachment-path';
import type { Plugin } from 'obsidian';

import { CUSTOM_ATTACHMENT_LOCATION_PLUGIN_ID } from '@mnaoumov/obsidian-lib/attachment-path';
import { publishPluginApi } from '@mnaoumov/obsidian-lib/plugin/plugin-api';
import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { Component } from 'obsidian';

/**
 * Parameters for {@link publishCustomAttachmentLocationStub}: the two members the library calls.
 */
export interface PublishCustomAttachmentLocationStubParams {
  /**
   * Resolves where an attachment belongs, standing in for the plugin's own resolution.
   */
  readonly getAvailablePathForAttachments: (params: GetAvailablePathForAttachmentsExtendedFunctionParams) => Promise<string>;

  /**
   * Whether a folder is an attachment unit folder, standing in for the plugin's own designation.
   */
  readonly isAttachmentUnitFolder: (folderPath: string) => boolean;
}

/**
 * The argument the library passes to the published isAttachmentUnitFolder.
 */
interface IsAttachmentUnitFolderParams {
  readonly folderPath: string;
}

/**
 * The contract version the library looks the attachment-path API up with (`^1.3.0`).
 */
const ATTACHMENT_PATH_API_VERSION = '1.3.0';

const publishedComponents: Component[] = [];

/**
 * Publishes a stand-in `Custom Attachment Location` attachment-path API.
 *
 * @param params - The parameters.
 */
export function publishCustomAttachmentLocationStub(params: PublishCustomAttachmentLocationStubParams): void {
  const component = new Component();
  component.load();
  publishedComponents.push(component);
  publishPluginApi({
    api: {
      getAvailablePathForAttachments: params.getAvailablePathForAttachments,
      isAttachmentUnitFolder: ({ folderPath }: IsAttachmentUnitFolderParams): boolean => params.isAttachmentUnitFolder(folderPath)
    },
    apiVersion: ATTACHMENT_PATH_API_VERSION,
    component,
    plugin: castTo<Plugin>({ manifest: { id: CUSTOM_ATTACHMENT_LOCATION_PLUGIN_ID } })
  });
}

/**
 * Revokes every stand-in published by {@link publishCustomAttachmentLocationStub}.
 */
export function revokeCustomAttachmentLocationStubs(): void {
  for (const component of publishedComponents.splice(0)) {
    component.unload();
  }
}
