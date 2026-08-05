import type {
  App,
  TFile
} from 'obsidian';
import type { ResourceLockComponent } from 'obsidian-dev-utils/obsidian/resource-lock';

import type { Frontmatter } from './frontmatter-merge.ts';

import {
  extractFrontmatter,
  mergeRecursively
} from './frontmatter-merge.ts';
import { runLockedTransaction } from './locked-transaction.ts';
import { resolveTemplateTokens } from './template-tokens.ts';

/**
 * The identity template: it reproduces the extracted content and adds nothing. The recursive split hands it
 * to every `SplitComposer` it drives, so the structural passes write the content untouched and the real
 * template is applied afterwards by {@link applySplitTemplateToNotes}.
 *
 * It must be `{{content}}` and NOT the empty string: applying a template yields the TEMPLATE with
 * `{{content}}` substituted, so an empty template would discard the extracted content entirely.
 */
export const CONTENT_ONLY_TEMPLATE = '{{content}}';

/**
 * Parameters for {@link applySplitTemplateToNotes}.
 */
export interface ApplySplitTemplateToNotesParams {
  readonly app: App;

  /**
   * The notes to template, each paired with the note it was split out of.
   */
  readonly notes: readonly SplitTemplateNote[];

  readonly resourceLockComponent: ResourceLockComponent;

  /**
   * The template to apply, already resolved from the settings (see `resolveSplitTemplateForNewTargetFile`).
   */
  readonly template: string;
}

/**
 * A note produced by a split, together with the note it came out of — which is what
 * `{{fromTitle}}` / `{{fromPath}}` / `{{fromParentFolder}}` resolve against.
 */
export interface SplitTemplateNote {
  readonly file: TFile;
  readonly sourceFile: TFile;
}

interface ApplySplitTemplateToNoteParams {
  readonly app: App;
  readonly note: SplitTemplateNote;
  readonly resourceLockComponent: ResourceLockComponent;
  readonly template: string;
}

/**
 * Wraps each produced note in the split template, AFTER the whole tree has been built.
 *
 * The recursive split cannot template a note as it creates it: the next pass splits that note's
 * sub-headings back out of it, and anything the template wrote below `{{content}}` sits under the note's
 * last heading — so it would be dragged into that heading's own note, leaving the parent without it and the
 * child with two copies (issue #172). Deferring the template until the note's children are gone is what
 * makes "every produced note is templated exactly once" true.
 *
 * @param params - The notes to template and the template to apply.
 * @returns A {@link Promise} that resolves when every note has been templated.
 */
export async function applySplitTemplateToNotes(params: ApplySplitTemplateToNotesParams): Promise<void> {
  const {
    app,
    notes,
    resourceLockComponent,
    template
  } = params;

  // Nothing to add, so leave every note exactly as the split wrote it.
  if (template === CONTENT_ONLY_TEMPLATE) {
    return;
  }

  for (const note of notes) {
    await applySplitTemplateToNote({
      app,
      note,
      resourceLockComponent,
      template
    });
  }
}

/**
 * Applies the split template to one produced note: its current content becomes `{{content}}`, and any
 * frontmatter the template itself carries is merged into the note's own (new values winning, exactly as
 * `insertIntoTargetFile` does for a brand-new target file).
 *
 * @param params - The note, the template, and the app/lock context.
 * @returns A {@link Promise} that resolves when the note has been templated.
 */
async function applySplitTemplateToNote(params: ApplySplitTemplateToNoteParams): Promise<void> {
  const {
    app,
    note,
    resourceLockComponent,
    template
  } = params;

  const abortController = new AbortController();
  await runLockedTransaction({
    abortController,
    app,
    body: async (vaultTransaction) => {
      const content = await app.vault.read(note.file);
      const { content: body, frontmatter: originalFrontmatter } = extractFrontmatter(content);
      // The note's own frontmatter block is left in place, so a note that carries one (a
      // `frontmatterTitleMode` title, an included source frontmatter) keeps it untouched unless the
      // Template has frontmatter of its own to merge in.
      const originalFrontmatterBlock = content.slice(0, content.length - body.length);

      const templatedContent = resolveTemplateTokens({
        content: body,
        sourceFile: note.sourceFile,
        targetFile: note.file,
        template
      });
      const { content: newBody, frontmatter: templateFrontmatter } = extractFrontmatter(templatedContent);

      // Without a frontmatter block above it, a body starting with `---` would be read back as this note's
      // Frontmatter — the same guard `insertIntoTargetFileImpl` applies.
      const shouldGuardLeadingSeparator = !originalFrontmatterBlock && newBody.startsWith('---\n');
      await vaultTransaction.process(
        note.file,
        () => `${originalFrontmatterBlock}${shouldGuardLeadingSeparator ? '\n' : ''}${newBody}`
      );

      if (Object.keys(templateFrontmatter).length === 0) {
        return;
      }

      const originalTitle = originalFrontmatter.title;
      await app.fileManager.processFrontMatter(note.file, (frontmatter: Frontmatter) => {
        mergeRecursively({ newObject: templateFrontmatter, oldObject: frontmatter });
        // A split's new-file title is governed by `frontmatterTitleMode`, not by what is merged in, so the
        // Note's own title wins and a note that had none stays without one — mirroring the title rule in
        // `insertIntoTargetFile` for a split into a brand-new target file.
        if (originalTitle === undefined) {
          delete frontmatter.title;
        } else {
          frontmatter.title = originalTitle;
        }
      });
    },
    lockTargets: [{ mode: 'file', pathOrFile: note.file }],
    operationName: 'Split note',
    resourceLockComponent
  });
}
