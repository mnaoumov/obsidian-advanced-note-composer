import type {
  App,
  Plugin,
  TAbstractFile
} from 'obsidian';

import { Component } from 'obsidian';
import { castTo } from 'obsidian-dev-utils/object-utils';
import { publishPluginApi } from 'obsidian-dev-utils/obsidian/plugin/plugin-api';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { CustomAttachmentLocationApi } from './custom-attachment-location.ts';

import {
  collectAttachmentsWithCustomAttachmentLocation,
  CUSTOM_ATTACHMENT_LOCATION_PLUGIN_ID
} from './custom-attachment-location.ts';

/**
 * The registry is looked up by plugin id alone and the watch reads nothing off the app until it has to
 * explain an absence, so an empty strict proxy is the whole app these calls need — and proves it.
 */
const app = strictProxy<App>({});

const NOTE_FILE = castTo<TAbstractFile>({ path: 'note.md' });

const providerComponents: Component[] = [];

afterEach(() => {
  // The registry lives on the realm global, so a record left published would answer the next test.
  for (const component of providerComponents.splice(0)) {
    component.unload();
  }
});

/**
 * Publishes a stand-in Custom Attachment Location API, exactly as that plugin does.
 *
 * @param apiVersion - The contract version to publish under.
 * @param api - The API object.
 */
function publish(apiVersion: string, api: object): void {
  const component = new Component();
  component.load();
  providerComponents.push(component);
  publishPluginApi({
    api,
    apiVersion,
    component,
    plugin: castTo<Plugin>({ manifest: { id: CUSTOM_ATTACHMENT_LOCATION_PLUGIN_ID } })
  });
}

describe('collectAttachmentsWithCustomAttachmentLocation', () => {
  it('should hand the notes to the published API', async () => {
    const collectAttachments = vi.fn<CustomAttachmentLocationApi['collectAttachments']>().mockResolvedValue();
    publish('1.2.0', { collectAttachments });

    await collectAttachmentsWithCustomAttachmentLocation({ abstractFiles: [NOTE_FILE], app });

    expect(collectAttachments).toHaveBeenCalledWith({ pathsOrFiles: [NOTE_FILE] });
  });

  it('should pass a copy, so the other plugin cannot mutate this plugin\'s array', async () => {
    const collectAttachments = vi.fn<CustomAttachmentLocationApi['collectAttachments']>().mockResolvedValue();
    publish('1.2.0', { collectAttachments });
    const abstractFiles = [NOTE_FILE];

    await collectAttachmentsWithCustomAttachmentLocation({ abstractFiles, app });

    expect(collectAttachments).toHaveBeenCalledOnce();
    expect(collectAttachments.mock.calls[0]?.[0].pathsOrFiles).not.toBe(abstractFiles);
  });

  it('should report it as unavailable when nothing is published', () => {
    // Not installed, disabled, and not yet loaded all look like this from here.
    expect(collectAttachmentsWithCustomAttachmentLocation({ abstractFiles: [NOTE_FILE], app })).toBeNull();
  });

  it('should report it as unavailable when the published contract predates collectAttachments', () => {
    // Contract 1.1.0 is what Custom Attachment Location 12.x publishes: the API exists, the member does not.
    const collectAttachments = vi.fn<CustomAttachmentLocationApi['collectAttachments']>().mockResolvedValue();
    publish('1.1.0', { collectAttachments });

    expect(collectAttachmentsWithCustomAttachmentLocation({ abstractFiles: [NOTE_FILE], app })).toBeNull();
    expect(collectAttachments).not.toHaveBeenCalled();
  });

  it('should report it as unavailable when the published API lacks collectAttachments', () => {
    // The consumer's own contract is what makes this a miss rather than a call into `undefined`.
    publish('1.2.0', {});

    expect(collectAttachmentsWithCustomAttachmentLocation({ abstractFiles: [NOTE_FILE], app })).toBeNull();
  });

  it('should do nothing when there are no notes to collect', async () => {
    const collectAttachments = vi.fn<CustomAttachmentLocationApi['collectAttachments']>().mockResolvedValue();
    publish('1.2.0', { collectAttachments });

    await collectAttachmentsWithCustomAttachmentLocation({ abstractFiles: [], app });

    expect(collectAttachments).not.toHaveBeenCalled();
  });
});
