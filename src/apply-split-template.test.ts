import type {
  App as AppOriginal,
  TFile
} from 'obsidian';
import type { GenericObject } from 'obsidian-dev-utils/type-guards';

import { castTo } from 'obsidian-dev-utils/object-utils';
import { ResourceLockComponent } from 'obsidian-dev-utils/obsidian/resource-lock';
import { ensureNonNullable } from 'obsidian-dev-utils/type-guards';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  applySplitTemplateToNotes,
  CONTENT_ONLY_TEMPLATE
} from './apply-split-template.ts';

const PARENT_PATH = 'Parent.md';
const NOTE_PATH = 'Parent/Child.md';

let app: AppOriginal;
let resourceLockComponent: ResourceLockComponent;

beforeEach(() => {
  app = App.createConfigured__({
    files: {
      [NOTE_PATH]: '## Child\n\nchild body',
      [PARENT_PATH]: 'parent body'
    }
  }).asOriginalType__();
  // Test-mocks' MetadataCache is a strict proxy with no indexer; `processFrontMatter` triggers a recompute,
  // So stub it to a no-op. Its markdown parser also throws on some perfectly valid content (a `---`
  // Thematic break), and every vault write triggers it — stub that too, since indexing is not under test.
  castTo<GenericObject>(app.metadataCache)['computeMetadataAsync'] = vi.fn();
  castTo<GenericObject>(app.metadataCache)['parseFileMetadata'] = vi.fn().mockReturnValue({});
  resourceLockComponent = new ResourceLockComponent(app, 'test-plugin');
  resourceLockComponent.load();
});

afterEach(() => {
  resourceLockComponent.unload();
  vi.restoreAllMocks();
});

async function apply(template: string, notePath = NOTE_PATH): Promise<void> {
  await applySplitTemplateToNotes({
    app,
    notes: [{ file: getFile(notePath), sourceFile: getFile(PARENT_PATH) }],
    resourceLockComponent,
    template
  });
}

function getFile(path: string): TFile {
  return ensureNonNullable(app.vault.getFileByPath(path));
}

async function read(path = NOTE_PATH): Promise<string> {
  return await app.vault.read(getFile(path));
}

async function setContent(content: string, path = NOTE_PATH): Promise<void> {
  await app.vault.modify(getFile(path), content);
}

describe('applySplitTemplateToNotes', () => {
  it('should wrap the note in the template, resolving its tokens against the note and its source', async () => {
    await apply('# {{newTitle}}\n\n{{content}}\n\n---\nFrom: [[{{fromTitle}}]]');

    expect(await read()).toBe('# Child\n\n## Child\n\nchild body\n\n---\nFrom: [[Parent]]');
  });

  it('should leave the note untouched for the identity template', async () => {
    await apply(CONTENT_ONLY_TEMPLATE);

    expect(await read()).toBe('## Child\n\nchild body');
  });

  it('should template every note it is given', async () => {
    await applySplitTemplateToNotes({
      app,
      notes: [
        { file: getFile(NOTE_PATH), sourceFile: getFile(PARENT_PATH) },
        { file: getFile(PARENT_PATH), sourceFile: getFile(NOTE_PATH) }
      ],
      resourceLockComponent,
      template: '{{content}}\n\nfrom {{fromTitle}}'
    });

    expect(await read()).toBe('## Child\n\nchild body\n\nfrom Parent');
    expect(await read(PARENT_PATH)).toBe('parent body\n\nfrom Child');
  });

  it('should keep the note\'s own frontmatter block when the template has none', async () => {
    await setContent('---\ntags:\n  - kept\n---\nchild body');

    await apply('{{content}}\n\ntrailer');

    expect(await read()).toBe('---\ntags:\n  - kept\n---\nchild body\n\ntrailer');
  });

  it('should merge the template\'s frontmatter into the note\'s, with the template winning', async () => {
    await setContent('---\nstatus: draft\ntags:\n  - a\n---\nchild body');

    await apply('---\nstatus: done\ntags:\n  - b\n---\n{{content}}');

    const content = await read();
    expect(content).toContain('child body');
    // The template's frontmatter is merged into the note's own, not written into its body.
    expect(content).not.toContain('status: done\ntags:\n  - b\n---\n\nchild body');
    const frontmatter = parseFrontmatter(content);
    expect(frontmatter).toContain('status: done');
    expect(frontmatter).toContain('- a');
    expect(frontmatter).toContain('- b');
  });

  it('should keep the note\'s own title when the template sets one too', async () => {
    await setContent('---\ntitle: Kept Title\n---\nchild body');

    await apply('---\ntitle: Template Title\n---\n{{content}}');

    expect(parseFrontmatter(await read())).toContain('title: Kept Title');
  });

  it('should drop a template title when the note had none', async () => {
    await apply('---\ntitle: Template Title\n---\n{{content}}');

    expect(await read()).not.toContain('Template Title');
  });

  it('should keep a leading separator out of the frontmatter position', async () => {
    // Without the guard the note would open with `---`, which Obsidian reads back as frontmatter.
    await apply('---\nabove\n\n{{content}}');

    const content = await read();
    expect(content.startsWith('\n---\nabove')).toBe(true);
  });
});

/**
 * Extracts a note's frontmatter block as text, so a test can assert on it without depending on YAML key
 * order.
 *
 * @param content - The note content.
 * @returns The frontmatter block's text, or an empty string when the note has none.
 */
function parseFrontmatter(content: string): string {
  const match = /^---\n(?<Frontmatter>[\s\S]*?)\n---\n/.exec(content);
  return match?.groups?.['Frontmatter'] ?? '';
}
