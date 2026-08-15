import type {
  App as AppOriginal,
  TFile,
  TFolder
} from 'obsidian';

import { VaultTransaction } from 'obsidian-dev-utils/obsidian/vault-transaction';
import { ensureNonNullable } from 'obsidian-dev-utils/type-guards';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  describe,
  expect,
  it
} from 'vitest';

import type { Selection } from './composers/composer-base.ts';

import {
  collectAttachmentsOwnedByNote,
  collectAttachmentsReferencedBySelections,
  collectAttachmentsToRelocate,
  relocateAttachments,
  resolveAttachmentDestination
} from './attachments.ts';

let app: AppOriginal;

function getFile(path: string): TFile {
  return ensureNonNullable(app.vault.getFileByPath(path));
}

function getFolder(path: string): TFolder {
  return ensureNonNullable(app.vault.getFolderByPath(path));
}

function initApp(files: Record<string, string>, attachmentFolderPath = '/'): void {
  app = App.createConfigured__({ files }).asOriginalType__();
  app.vault.setConfig('attachmentFolderPath', attachmentFolderPath);
}

describe('collectAttachmentsOwnedByNote', () => {
  it('should collect an attachment the note embeds', () => {
    initApp({
      'Docs/img.png': 'PIC',
      'Docs/note.md': '![[img.png]]'
    });

    const attachments = collectAttachmentsOwnedByNote({ app, attachmentExtensions: [], noteFile: getFile('Docs/note.md') });

    expect(attachments.map((attachment) => attachment.file.path)).toEqual(['Docs/img.png']);
    expect(attachments[0]?.ownerNoteFile.path).toBe('Docs/note.md');
  });

  it('should never collect a link to an ordinary note', () => {
    initApp({
      'Docs/other.md': 'body',
      'Docs/zeta.md': '[[other]]'
    });

    const attachments = collectAttachmentsOwnedByNote({ app, attachmentExtensions: [], noteFile: getFile('Docs/zeta.md') });

    expect(attachments).toEqual([]);
  });

  it('should collect a markdown-shaped attachment the note embeds', () => {
    // The note sorts after the drawing on purpose: the mock resolves a link when the note is created.
    initApp({
      'Docs/sketch.excalidraw.md': 'drawing',
      'Docs/zeta.md': '![[sketch.excalidraw]]'
    });

    const attachments = collectAttachmentsOwnedByNote({ app, attachmentExtensions: ['.excalidraw.md'], noteFile: getFile('Docs/zeta.md') });

    expect(attachments.map((attachment) => attachment.file.path)).toEqual(['Docs/sketch.excalidraw.md']);
  });

  it('should leave an attachment another note also references', () => {
    initApp({
      'Docs/img.png': 'PIC',
      'Docs/x.md': '![[img.png]]',
      'Docs/y.md': '![[img.png]]'
    });

    const attachments = collectAttachmentsOwnedByNote({ app, attachmentExtensions: [], noteFile: getFile('Docs/x.md') });

    expect(attachments).toEqual([]);
  });

  it('should leave an unreferenced neighbor alone', () => {
    // A note shares its folder with its neighbors, so an unreferenced file beside it is nobody's
    // Attachment — unlike a folder merge, which is moving the whole folder anyway.
    initApp({
      'Docs/note.md': 'body',
      'Docs/stray.png': 'PIC'
    }, './');

    const attachments = collectAttachmentsOwnedByNote({ app, attachmentExtensions: [], noteFile: getFile('Docs/note.md') });

    expect(attachments).toEqual([]);
  });

  it('should return the attachments in path order', () => {
    initApp({
      'Docs/a.png': 'A',
      'Docs/b.png': 'B',
      'Docs/note.md': '![[b.png]]\n![[a.png]]'
    });

    const attachments = collectAttachmentsOwnedByNote({ app, attachmentExtensions: [], noteFile: getFile('Docs/note.md') });

    expect(attachments.map((attachment) => attachment.file.path)).toEqual(['Docs/a.png', 'Docs/b.png']);
  });
});

describe('collectAttachmentsReferencedBySelections', () => {
  function collect(notePath: string, selections: Selection[], attachmentExtensions: string[] = []): string[] {
    return collectAttachmentsReferencedBySelections({
      app,
      attachmentExtensions,
      selections,
      sourceFile: getFile(notePath)
    }).map((attachment) => attachment.file.path);
  }

  it('should collect an attachment the extracted range embeds', () => {
    const content = '# A\n![[img.png]]\n\n# B\nplain';
    initApp({
      'Docs/img.png': 'PIC',
      'Docs/note.md': content
    });

    const attachments = collectAttachmentsReferencedBySelections({
      app,
      attachmentExtensions: [],
      selections: [{ endOffset: content.indexOf('# B'), startOffset: 0 }],
      sourceFile: getFile('Docs/note.md')
    });

    expect(attachments.map((attachment) => attachment.file.path)).toEqual(['Docs/img.png']);
    // The extracted text is what referenced it, so the source note is where it came FROM.
    expect(attachments[0]?.ownerNoteFile.path).toBe('Docs/note.md');
  });

  it('should leave an attachment the text left behind still references', () => {
    // The whole point of the sole-referencer rule: moving this one would break the heading that stays.
    const content = '# A\n![[img.png]]\n\n# B\n![[img.png]]';
    initApp({
      'Docs/img.png': 'PIC',
      'Docs/note.md': content
    });

    expect(collect('Docs/note.md', [{ endOffset: content.indexOf('# B'), startOffset: 0 }])).toEqual([]);
  });

  it('should leave an attachment another note also references', () => {
    const content = '# A\n![[img.png]]';
    initApp({
      'Docs/img.png': 'PIC',
      'Docs/x.md': content,
      'Docs/y.md': '![[img.png]]'
    });

    expect(collect('Docs/x.md', [{ endOffset: content.length, startOffset: 0 }])).toEqual([]);
  });

  it('should leave an attachment whose reference straddles the selection boundary', () => {
    // Half an embed is not extracted, so the note keeps pointing at the file.
    const content = '# A\n![[img.png]]';
    initApp({
      'Docs/img.png': 'PIC',
      'Docs/note.md': content
    });

    expect(collect('Docs/note.md', [{ endOffset: content.length - 3, startOffset: 0 }])).toEqual([]);
  });

  it('should never collect a link to an ordinary note', () => {
    const content = '[[other]]';
    initApp({
      'Docs/other.md': 'body',
      'Docs/zeta.md': content
    });

    expect(collect('Docs/zeta.md', [{ endOffset: content.length, startOffset: 0 }])).toEqual([]);
  });

  it('should collect a markdown-shaped attachment the extracted range embeds', () => {
    // The note sorts after the drawing on purpose: the mock resolves a link when the note is created.
    const content = '![[sketch.excalidraw]]';
    initApp({
      'Docs/sketch.excalidraw.md': 'drawing',
      'Docs/zeta.md': content
    });

    expect(collect('Docs/zeta.md', [{ endOffset: content.length, startOffset: 0 }], ['.excalidraw.md'])).toEqual(['Docs/sketch.excalidraw.md']);
  });

  it('should ignore a link that resolves to nothing', () => {
    const content = '![[missing.png]]';
    initApp({ 'Docs/note.md': content });

    expect(collect('Docs/note.md', [{ endOffset: content.length, startOffset: 0 }])).toEqual([]);
  });

  it('should collect an attachment a plain link points at, not only an embed', () => {
    // A heading that merely links its PDF owns it just as much as one that embeds an image.
    const content = '[[doc.pdf]]';
    initApp({
      'Docs/doc.pdf': 'PDF',
      'Docs/note.md': content
    });

    expect(collect('Docs/note.md', [{ endOffset: content.length, startOffset: 0 }])).toEqual(['Docs/doc.pdf']);
  });

  it('should collect nothing when the selection references nothing', () => {
    const content = '# A\nplain\n\n# B\n![[img.png]]';
    initApp({
      'Docs/img.png': 'PIC',
      'Docs/note.md': content
    });

    expect(collect('Docs/note.md', [{ endOffset: content.indexOf('# B'), startOffset: 0 }])).toEqual([]);
  });

  it('should return the attachments in path order', () => {
    const content = '![[b.png]]\n![[a.png]]';
    initApp({
      'Docs/a.png': 'A',
      'Docs/b.png': 'B',
      'Docs/note.md': content
    });

    expect(collect('Docs/note.md', [{ endOffset: content.length, startOffset: 0 }])).toEqual(['Docs/a.png', 'Docs/b.png']);
  });
});

describe('collectAttachmentsToRelocate', () => {
  it('should collect a file referenced by a merged note', async () => {
    initApp({
      'Docs/img.png': 'PIC',
      'Docs/note.md': '![[img.png]]'
    });

    const attachments = await collectAttachmentsToRelocate({ app, folder: getFolder('Docs'), noteFiles: [getFile('Docs/note.md')] });

    expect(attachments.map((attachment) => attachment.file.path)).toEqual(['Docs/img.png']);
    expect(attachments[0]?.ownerNoteFile.path).toBe('Docs/note.md');
  });

  it('should collect a referenced file from a sub-folder', async () => {
    initApp({
      'Docs/api/img.png': 'PIC',
      'Docs/api/note.md': '![[img.png]]'
    });

    const attachments = await collectAttachmentsToRelocate({ app, folder: getFolder('Docs'), noteFiles: [getFile('Docs/api/note.md')] });

    expect(attachments.map((attachment) => attachment.file.path)).toEqual(['Docs/api/img.png']);
  });

  it('should collect a markdown-shaped attachment that a merged note embeds', async () => {
    // The note sorts after the drawing on purpose: the mock resolves a link when the note is created.
    initApp({
      'Docs/sketch.excalidraw.md': 'drawing',
      'Docs/zeta.md': '![[sketch.excalidraw]]'
    });

    const attachments = await collectAttachmentsToRelocate({ app, folder: getFolder('Docs'), noteFiles: [getFile('Docs/zeta.md')] });

    expect(attachments.map((attachment) => attachment.file.path)).toEqual(['Docs/sketch.excalidraw.md']);
  });

  it('should collect an unreferenced file sitting at a merged note\'s proper attachment path', async () => {
    // Attachments belong beside their note, so the stray is already where this note's attachments live.
    initApp({
      'Docs/note.md': 'body',
      'Docs/stray.png': 'PIC'
    }, './');

    const attachments = await collectAttachmentsToRelocate({ app, folder: getFolder('Docs'), noteFiles: [getFile('Docs/note.md')] });

    expect(attachments.map((attachment) => attachment.file.path)).toEqual(['Docs/stray.png']);
    expect(attachments[0]?.ownerNoteFile.path).toBe('Docs/note.md');
  });

  it('should leave an unreferenced file that is not at any merged note\'s attachment path', async () => {
    // Attachments belong in a fixed folder elsewhere, so the stray is not an attachment of this note.
    initApp({
      'Docs/note.md': 'body',
      'Docs/stray.png': 'PIC'
    }, 'Files');

    const attachments = await collectAttachmentsToRelocate({ app, folder: getFolder('Docs'), noteFiles: [getFile('Docs/note.md')] });

    expect(attachments).toEqual([]);
  });

  it('should not consult a note whose folder does not contain the file', async () => {
    // The only note lives deeper than the stray, so nothing claims it.
    initApp({
      'Docs/api/note.md': 'body',
      'Docs/stray.png': 'PIC'
    }, './');

    const attachments = await collectAttachmentsToRelocate({ app, folder: getFolder('Docs'), noteFiles: [getFile('Docs/api/note.md')] });

    expect(attachments).toEqual([]);
  });

  it('should treat a note at the vault root as containing every folder', async () => {
    // Reachable through `Flatten folder...`, which can promote a note all the way to the root.
    initApp({
      'note.md': 'body',
      'stray.png': 'PIC'
    }, './');

    const attachments = await collectAttachmentsToRelocate({ app, folder: app.vault.getRoot(), noteFiles: [getFile('note.md')] });

    expect(attachments.map((attachment) => attachment.file.path)).toEqual(['stray.png']);
  });

  it('should not collect the notes being merged', async () => {
    initApp({
      'Docs/a.md': '[[b]]',
      'Docs/b.md': 'body'
    });

    const attachments = await collectAttachmentsToRelocate({
      app,
      folder: getFolder('Docs'),
      noteFiles: [getFile('Docs/a.md'), getFile('Docs/b.md')]
    });

    expect(attachments).toEqual([]);
  });

  it('should attribute a file referenced by two notes to the first of them', async () => {
    // The notes sort after the image on purpose: the mock resolves a link when the note is created, so
    // The image has to exist first for either note to reference it.
    initApp({
      'Docs/img.png': 'PIC',
      'Docs/x.md': '![[img.png]]',
      'Docs/y.md': '![[img.png]]'
    });

    const attachments = await collectAttachmentsToRelocate({
      app,
      folder: getFolder('Docs'),
      noteFiles: [getFile('Docs/x.md'), getFile('Docs/y.md')]
    });

    expect(attachments[0]?.ownerNoteFile.path).toBe('Docs/x.md');
  });

  it('should return the attachments in path order', async () => {
    initApp({
      'Docs/a.png': 'A',
      'Docs/b.png': 'B',
      'Docs/note.md': '![[b.png]]\n![[a.png]]'
    });

    const attachments = await collectAttachmentsToRelocate({ app, folder: getFolder('Docs'), noteFiles: [getFile('Docs/note.md')] });

    expect(attachments.map((attachment) => attachment.file.path)).toEqual(['Docs/a.png', 'Docs/b.png']);
  });
});

describe('resolveAttachmentDestination', () => {
  it('should resolve against the note the attachment now belongs to', async () => {
    initApp({
      'Docs.md': '',
      'Docs/img.png': 'PIC',
      'Docs/note.md': '![[img.png]]'
    }, './');

    const newPath = await resolveAttachmentDestination({
      app,
      attachment: getFile('Docs/img.png'),
      newNoteFile: getFile('Docs.md'),
      oldNoteFile: getFile('Docs/note.md')
    });

    // The merged note lives at the vault root, so its attachments do too.
    expect(newPath).toBe('img.png');
  });
});

describe('relocateAttachments', () => {
  it('should move each attachment through the transaction', async () => {
    initApp({
      'Docs.md': '',
      'Docs/img.png': 'PIC',
      'Docs/note.md': '![[img.png]]'
    }, './');
    const vaultTransaction = new VaultTransaction({ app });

    await relocateAttachments({
      app,
      relocations: [{
        attachment: getFile('Docs/img.png'),
        newNoteFile: getFile('Docs.md'),
        oldNoteFile: getFile('Docs/note.md')
      }],
      vaultTransaction
    });
    await vaultTransaction.commit();

    expect(await app.vault.adapter.exists('img.png')).toBe(true);
    expect(await app.vault.adapter.exists('Docs/img.png')).toBe(false);
  });

  it('should leave an attachment that is already where it belongs', async () => {
    initApp({
      'Docs/img.png': 'PIC',
      'Docs/note.md': '![[img.png]]'
    }, './');
    const vaultTransaction = new VaultTransaction({ app });

    await relocateAttachments({
      app,
      relocations: [{
        attachment: getFile('Docs/img.png'),
        newNoteFile: getFile('Docs/note.md'),
        oldNoteFile: getFile('Docs/note.md')
      }],
      vaultTransaction
    });
    await vaultTransaction.commit();

    expect(await app.vault.adapter.exists('Docs/img.png')).toBe(true);
  });

  it('should put the attachments back when the transaction rolls back', async () => {
    initApp({
      'Docs.md': '',
      'Docs/img.png': 'PIC',
      'Docs/note.md': '![[img.png]]'
    }, './');
    const vaultTransaction = new VaultTransaction({ app });

    await relocateAttachments({
      app,
      relocations: [{
        attachment: getFile('Docs/img.png'),
        newNoteFile: getFile('Docs.md'),
        oldNoteFile: getFile('Docs/note.md')
      }],
      vaultTransaction
    });
    await vaultTransaction.rollback();

    expect(await app.vault.adapter.exists('Docs/img.png')).toBe(true);
    expect(await app.vault.adapter.exists('img.png')).toBe(false);
  });
});
