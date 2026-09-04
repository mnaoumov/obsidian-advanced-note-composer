import type {
  App,
  TAbstractFile
} from 'obsidian';

import { castTo } from 'obsidian-dev-utils/object-utils';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  checkIsCustomAttachmentLocationAvailable,
  collectAttachmentsWithCustomAttachmentLocation,
  CUSTOM_ATTACHMENT_LOCATION_PLUGIN_ID
} from './custom-attachment-location.ts';

/**
 * Builds an app whose registry holds the given Custom Attachment Location.
 *
 * Not a candidate for `obsidian-test-mocks`' `registerPlugin__`, despite looking like one: this builds a
 * standalone fake rather than stubbing around `App.createConfigured__()`'s strict proxy, so there is no real
 * registry here to seed. The functions under test take any app shape and are asked about deliberately
 * malformed plugins, so giving them a whole configured vault to reach one `getPlugin` would widen what the
 * test isolates rather than narrow it.
 *
 * @param plugin - What `getPlugin` returns for that id.
 * @returns The app.
 */
function createApp(plugin: unknown): App {
  return strictProxy<App>({
    plugins: strictProxy<App['plugins']>({
      getPlugin: (id: string) => (id === CUSTOM_ATTACHMENT_LOCATION_PLUGIN_ID ? castTo<never>(plugin) : null)
    })
  });
}

const NOTE_FILE = castTo<TAbstractFile>({ path: 'note.md' });

describe('checkIsCustomAttachmentLocationAvailable', () => {
  it('should report the plugin as available when it exposes the entry point', () => {
    expect(checkIsCustomAttachmentLocationAvailable(createApp({ collectAttachmentsInAbstractFiles: vi.fn() }))).toBe(true);
  });

  it('should report it as unavailable when it is not installed or is disabled', () => {
    expect(checkIsCustomAttachmentLocationAvailable(createApp(null))).toBe(false);
  });

  it('should report it as unavailable when the installed version predates the entry point', () => {
    // The method arrived later than the plugin, so having the plugin is not having the method.
    expect(checkIsCustomAttachmentLocationAvailable(createApp({}))).toBe(false);
  });

  it('should report it as unavailable when the entry point is not callable', () => {
    expect(checkIsCustomAttachmentLocationAvailable(createApp({ collectAttachmentsInAbstractFiles: 'not a function' }))).toBe(false);
  });

  it('should tolerate a non-object standing in for the plugin', () => {
    expect(checkIsCustomAttachmentLocationAvailable(createApp('nonsense'))).toBe(false);
  });
});

describe('collectAttachmentsWithCustomAttachmentLocation', () => {
  it('should hand the notes to the other plugin', () => {
    const collectAttachmentsInAbstractFiles = vi.fn();
    const app = createApp({ collectAttachmentsInAbstractFiles });

    collectAttachmentsWithCustomAttachmentLocation({ abstractFiles: [NOTE_FILE], app });

    expect(collectAttachmentsInAbstractFiles).toHaveBeenCalledWith([NOTE_FILE]);
  });

  it('should pass a copy, so the other plugin cannot mutate this plugin\'s array', () => {
    const collectAttachmentsInAbstractFiles = vi.fn();
    const app = createApp({ collectAttachmentsInAbstractFiles });
    const abstractFiles = [NOTE_FILE];

    collectAttachmentsWithCustomAttachmentLocation({ abstractFiles, app });

    expect(collectAttachmentsInAbstractFiles).toHaveBeenCalledWith([NOTE_FILE]);
    expect(collectAttachmentsInAbstractFiles.mock.calls[0]?.[0]).not.toBe(abstractFiles);
  });

  it('should not throw when the plugin is not installed or is disabled', () => {
    expect(() => {
      collectAttachmentsWithCustomAttachmentLocation({ abstractFiles: [NOTE_FILE], app: createApp(null) });
    }).not.toThrow();
  });

  it('should not throw when the installed version predates the entry point', () => {
    // The method arrived later than the plugin, so having the plugin is not having the method.
    expect(() => {
      collectAttachmentsWithCustomAttachmentLocation({ abstractFiles: [NOTE_FILE], app: createApp({}) });
    }).not.toThrow();
  });

  it('should do nothing when there are no notes to collect', () => {
    const collectAttachmentsInAbstractFiles = vi.fn();
    const app = createApp({ collectAttachmentsInAbstractFiles });

    collectAttachmentsWithCustomAttachmentLocation({ abstractFiles: [], app });

    expect(collectAttachmentsInAbstractFiles).not.toHaveBeenCalled();
  });
});
