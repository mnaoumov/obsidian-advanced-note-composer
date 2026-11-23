import type { ConsoleDebugComponent } from '@mnaoumov/obsidian-lib/components/console-debug-component';
import type { PluginNoticeComponent } from '@mnaoumov/obsidian-lib/components/plugin-notice-component';
import type { ResourceLockComponent } from '@mnaoumov/obsidian-lib/resource-lock';
import type {
  App,
  Editor,
  HeadingCache,
  TFile,
  Vault
} from 'obsidian';

import { getCacheSafe } from '@mnaoumov/obsidian-lib/metadata-cache';
import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { PluginSettingsComponent } from '../settings/plugin-settings-component.ts';

import { InsertMode } from '../composers/insert-mode.ts';
import { CommandCategory } from '../settings/plugin-settings.ts';
import { SplitComposer } from '../split/split-composer.ts';
import {
  selectTargetHeading,
  selectTargetNoteForMove
} from './move-under-heading-modals.ts';
import {
  pickHeadingMoveDestination,
  runMoveUnderHeading
} from './move-under-heading.ts';

vi.mock('@mnaoumov/obsidian-lib/metadata-cache', () => ({ getCacheSafe: vi.fn() }));
vi.mock('./move-under-heading-modals.ts', () => ({ selectTargetHeading: vi.fn(), selectTargetNoteForMove: vi.fn() }));
vi.mock('../split/split-composer.ts', () => {
  const MockSplitComposer = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- vi.fn() prototype is untyped in mock factories.
  MockSplitComposer.prototype.splitFile = vi.fn().mockResolvedValue(undefined);
  return { SplitComposer: MockSplitComposer };
});

const TARGET_CONTENT = '# A\nalpha\n\n## B: b\nbeta\n';

function buildHeading(heading: string, level: number, startOffset: number, endOffset: number): HeadingCache {
  return {
    heading,
    level,
    position: {
      end: { col: 0, line: 0, offset: endOffset },
      start: { col: 0, line: 0, offset: startOffset }
    }
  };
}

const HEADINGS = [buildHeading('A', 1, 0, 3), buildHeading('B: b', 2, 11, 18)];

interface Mocks {
  readonly app: App;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly sourceFile: TFile;
  readonly targetFile: TFile;
}

function createMockFile(path: string): TFile {
  return strictProxy<TFile>({ path });
}

function createMocks(): Mocks {
  return {
    app: strictProxy<App>({
      vault: strictProxy<Vault>({ read: vi.fn().mockResolvedValue(TARGET_CONTENT) })
    }),
    pluginNoticeComponent: strictProxy<PluginNoticeComponent>({ showNotice: vi.fn() }),
    pluginSettingsComponent: strictProxy<PluginSettingsComponent>({}),
    sourceFile: createMockFile('source.md'),
    targetFile: createMockFile('target.md')
  };
}

function mockHeadings(headings: HeadingCache[] | undefined): void {
  vi.mocked(getCacheSafe).mockResolvedValue(castTo<Awaited<ReturnType<typeof getCacheSafe>>>(headings ? { headings } : {}));
}

describe('pickHeadingMoveDestination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return null when the note picker is dismissed', async () => {
    const mocks = createMocks();
    vi.mocked(selectTargetNoteForMove).mockResolvedValue(null);
    expect(await pickHeadingMoveDestination({ ...mocks, capturedSelections: [], commandCategory: CommandCategory.SplitAndExtract })).toBeNull();
    expect(selectTargetHeading).not.toHaveBeenCalled();
  });

  it('should refuse a note with no headings', async () => {
    const mocks = createMocks();
    vi.mocked(selectTargetNoteForMove).mockResolvedValue(mocks.targetFile);
    mockHeadings(undefined);
    expect(await pickHeadingMoveDestination({ ...mocks, capturedSelections: [], commandCategory: CommandCategory.SplitAndExtract })).toBeNull();
    expect(mocks.pluginNoticeComponent.showNotice).toHaveBeenCalledWith('Note target.md has no headings to move the selection under.');
  });

  it('should return null when the heading picker is dismissed', async () => {
    const mocks = createMocks();
    vi.mocked(selectTargetNoteForMove).mockResolvedValue(mocks.targetFile);
    mockHeadings(HEADINGS);
    vi.mocked(selectTargetHeading).mockResolvedValue(null);
    expect(await pickHeadingMoveDestination({ ...mocks, capturedSelections: [], commandCategory: CommandCategory.SplitAndExtract })).toBeNull();
  });

  it('should refuse when the chosen heading is gone once the picker closes', async () => {
    const mocks = createMocks();
    vi.mocked(selectTargetNoteForMove).mockResolvedValue(mocks.targetFile);
    mockHeadings(HEADINGS);
    vi.mocked(selectTargetHeading).mockImplementation(() => {
      mockHeadings(undefined);
      return Promise.resolve({ headingIndex: 1, insertMode: InsertMode.Append });
    });
    expect(await pickHeadingMoveDestination({ ...mocks, capturedSelections: [], commandCategory: CommandCategory.SplitAndExtract })).toBeNull();
    expect(mocks.pluginNoticeComponent.showNotice).toHaveBeenCalledWith('The chosen heading is no longer in note target.md.');
  });

  it('should resolve the end of the heading body and a subpath to the heading', async () => {
    const mocks = createMocks();
    vi.mocked(selectTargetNoteForMove).mockResolvedValue(mocks.targetFile);
    mockHeadings(HEADINGS);
    vi.mocked(selectTargetHeading).mockResolvedValue({ headingIndex: 1, insertMode: InsertMode.Append });
    const destination = await pickHeadingMoveDestination({ ...mocks, capturedSelections: [], commandCategory: CommandCategory.SplitAndExtract });
    expect(destination).toEqual({
      insertMode: InsertMode.Append,
      targetCursorOffset: TARGET_CONTENT.indexOf('beta') + 'beta'.length,
      targetFile: mocks.targetFile,
      targetSubpath: '#B b'
    });
    expect(selectTargetNoteForMove).toHaveBeenCalledWith(expect.objectContaining({ commandCategory: CommandCategory.SplitAndExtract }));
  });

  it('should refuse a heading of the same note that lies inside the selection', async () => {
    const mocks = createMocks();
    vi.mocked(selectTargetNoteForMove).mockResolvedValue(mocks.sourceFile);
    mockHeadings(HEADINGS);
    vi.mocked(selectTargetHeading).mockResolvedValue({ headingIndex: 0, insertMode: InsertMode.Prepend });

    const capturedSelections = [{ endOffset: 8, startOffset: 1 }];
    expect(await pickHeadingMoveDestination({ ...mocks, capturedSelections, commandCategory: CommandCategory.SplitAndExtract })).toBeNull();
    expect(mocks.pluginNoticeComponent.showNotice).toHaveBeenCalledWith('Cannot move a selection under a heading that is inside the selection itself.');
  });

  it('should allow a heading of the same note outside the selection', async () => {
    const mocks = createMocks();
    vi.mocked(selectTargetNoteForMove).mockResolvedValue(mocks.sourceFile);
    mockHeadings(HEADINGS);
    vi.mocked(selectTargetHeading).mockResolvedValue({ headingIndex: 0, insertMode: InsertMode.Prepend });

    const capturedSelections = [{ endOffset: 23, startOffset: 19 }];
    const destination = await pickHeadingMoveDestination({ ...mocks, capturedSelections, commandCategory: CommandCategory.SplitAndExtract });

    expect(destination?.targetCursorOffset).toBe(3);
  });
});

describe('runMoveUnderHeading', () => {
  it('should run the split composer at the destination without opening the target', async () => {
    vi.clearAllMocks();
    const mocks = createMocks();
    const editor = strictProxy<Editor>({});
    const capturedSelections = [{ endOffset: 2, startOffset: 0 }];
    await runMoveUnderHeading({
      app: mocks.app,
      capturedSelections,
      consoleDebugComponent: strictProxy<ConsoleDebugComponent>({}),
      destination: { insertMode: InsertMode.Prepend, targetCursorOffset: 3, targetFile: mocks.targetFile, targetSubpath: '#A' },
      editor,
      pluginNoticeComponent: mocks.pluginNoticeComponent,
      pluginSettingsComponent: mocks.pluginSettingsComponent,
      resourceLockComponent: strictProxy<ResourceLockComponent>({}),
      selectedText: 'xy',
      sourceFile: mocks.sourceFile
    });
    expect(SplitComposer).toHaveBeenCalledWith(expect.objectContaining({
      capturedSelections,
      editor,
      insertMode: InsertMode.Prepend,
      insertToken: expect.stringContaining('advanced-note-composer-move-') as unknown,
      isNewTargetFile: false,
      selectedText: 'xy',
      shouldOpenTargetAfterMove: false,
      shouldStartTemplateOnNewLine: true,
      sourceFile: mocks.sourceFile,
      targetCursorOffset: 3,
      targetFile: mocks.targetFile,
      targetSubpath: '#A'
    }));

    expect(vi.mocked(SplitComposer).prototype.splitFile).toHaveBeenCalled();
  });
});
