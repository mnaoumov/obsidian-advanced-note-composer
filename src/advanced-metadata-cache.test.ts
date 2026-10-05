import type {
  App,
  HeadingCache,
  Plugin,
  TFile
} from 'obsidian';

import { Component } from 'obsidian';
import { castTo } from 'obsidian-dev-utils/object-utils';
import { publishPluginApi } from 'obsidian-dev-utils/obsidian/plugin/plugin-api';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import { ensureNonNullable } from 'obsidian-dev-utils/type-guards';
import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type {
  AdvancedMetadataCacheApi,
  HeadingTimes
} from './advanced-metadata-cache.ts';

import {
  ADVANCED_METADATA_CACHE_PLUGIN_ID,
  readHeadingTimes
} from './advanced-metadata-cache.ts';

/**
 * The registry is looked up by plugin id alone, so an empty strict proxy is the whole app these calls need.
 */
const app = strictProxy<App>({});

const NOTE_FILE = castTo<TFile>({ path: 'note.md' });

const HEADINGS = [heading('A', 0), heading('B', 3)];

const TIMES: HeadingTimes[] = [
  { created: 1, heading: 'A', level: 1, line: 0, modified: 2, seen: 3 },
  { created: null, heading: 'B', level: 1, line: 3, modified: null, seen: null }
];

const providerComponents: Component[] = [];

afterEach(() => {
  // The registry lives on the realm global, so a record left published would answer the next test.
  for (const component of providerComponents.splice(0)) {
    component.unload();
  }
});

function heading(text: string, line: number): HeadingCache {
  return castTo<HeadingCache>({ heading: text, level: 1, position: { start: { line } } });
}

/**
 * Publishes a stand-in Advanced Metadata Cache API, exactly as that plugin does.
 *
 * @param apiVersion - The contract version to publish under.
 * @param times - What `getHeadingTimes` answers.
 * @returns The `getHeadingTimes` spy.
 */
function publish(apiVersion: string, times: HeadingTimes[]): ReturnType<typeof vi.fn<AdvancedMetadataCacheApi['getHeadingTimes']>> {
  const getHeadingTimes = vi.fn<AdvancedMetadataCacheApi['getHeadingTimes']>().mockReturnValue(times);
  const component = new Component();
  component.load();
  providerComponents.push(component);
  publishPluginApi({
    api: { getHeadingTimes },
    apiVersion,
    component,
    plugin: castTo<Plugin>({ manifest: { id: ADVANCED_METADATA_CACHE_PLUGIN_ID } })
  });
  return getHeadingTimes;
}

describe('readHeadingTimes', () => {
  it('should return the published times when they describe the same headings', () => {
    const getHeadingTimes = publish('1.2.0', TIMES);

    expect(readHeadingTimes({ app, file: NOTE_FILE, headings: HEADINGS })).toEqual(TIMES);
    expect(getHeadingTimes).toHaveBeenCalledWith(NOTE_FILE);
  });

  it('should return null when nothing is published', () => {
    expect(readHeadingTimes({ app, file: NOTE_FILE, headings: HEADINGS })).toBeNull();
  });

  it('should return null when the published contract predates getHeadingTimes', () => {
    publish('1.1.0', TIMES);

    expect(readHeadingTimes({ app, file: NOTE_FILE, headings: HEADINGS })).toBeNull();
  });

  it('should return null for a note with no headings, without asking', () => {
    const getHeadingTimes = publish('1.2.0', []);

    expect(readHeadingTimes({ app, file: NOTE_FILE, headings: [] })).toBeNull();
    expect(getHeadingTimes).not.toHaveBeenCalled();
  });

  it('should return null when the Headings module is off', () => {
    // The module answers an empty list while it is off.
    publish('1.2.0', []);

    expect(readHeadingTimes({ app, file: NOTE_FILE, headings: HEADINGS })).toBeNull();
  });

  it('should return null when the times came from another parse of the note', () => {
    publish('1.2.0', [ensureNonNullable(TIMES[0]), { ...ensureNonNullable(TIMES[1]), line: 4 }]);
    expect(readHeadingTimes({ app, file: NOTE_FILE, headings: HEADINGS })).toBeNull();
  });

  it('should return null when a heading text differs', () => {
    publish('1.2.0', [ensureNonNullable(TIMES[0]), { ...ensureNonNullable(TIMES[1]), heading: 'C' }]);
    expect(readHeadingTimes({ app, file: NOTE_FILE, headings: HEADINGS })).toBeNull();
  });
});
