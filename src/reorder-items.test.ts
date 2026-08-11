import {
  describe,
  expect,
  it
} from 'vitest';

import type {
  RenumberedItem,
  ReorderItemInput
} from './reorder-items.ts';

import {
  buildRenameSteps,
  buildRenumberPlan,
  ReorderItemKind
} from './reorder-items.ts';

const FILE_NAME_TEMPLATE = '{{index}}. {{safeName}}';
const FOLDER_NAME_TEMPLATE = '{{index}}. {{safeFolderName}}';

function buildFilePlan(names: readonly string[], nameTemplate = FILE_NAME_TEMPLATE): readonly RenumberedItem[] {
  return buildRenumberPlan({
    items: names.map((name) => toFile(name)),
    kind: ReorderItemKind.File,
    nameTemplate,
    parentFolder: 'Parent',
    parentFolderPath: 'Root/Parent'
  });
}

function buildFolderPlan(names: readonly string[], nameTemplate = FOLDER_NAME_TEMPLATE): readonly RenumberedItem[] {
  return buildRenumberPlan({
    items: names.map((name) => toFolder(name)),
    kind: ReorderItemKind.Folder,
    nameTemplate,
    parentFolder: 'Parent',
    parentFolderPath: 'Root/Parent'
  });
}

function toFile(name: string): ReorderItemInput {
  const extensionIndex = name.lastIndexOf('.');
  return {
    extension: name.slice(extensionIndex),
    name: name.slice(0, extensionIndex),
    path: `Root/Parent/${name}`
  };
}

function toFolder(name: string): ReorderItemInput {
  return {
    extension: '',
    name,
    path: `Root/Parent/${name}`
  };
}

function toNewNames(plan: readonly RenumberedItem[]): string[] {
  return plan.map((item) => item.newName);
}

describe('buildRenumberPlan', () => {
  it('should renumber the whole sequence from 1, in the order given', () => {
    expect(toNewNames(buildFolderPlan(['2. Beta', '3. Gamma', '1. Alpha']))).toEqual([
      '1. Beta',
      '2. Gamma',
      '3. Alpha'
    ]);
  });

  it('should number an item that never carried an index', () => {
    expect(toNewNames(buildFolderPlan(['Untitled 2', 'Untitled 1', 'Untitled']))).toEqual([
      '1. Untitled 2',
      '2. Untitled 1',
      '3. Untitled'
    ]);
  });

  it('should keep the base name verbatim, never re-casing or collapsing it', () => {
    expect(toNewNames(buildFolderPlan(['4. iPhone  NOTES']))).toEqual(['1. iPhone  NOTES']);
  });

  it('should follow a template with no separator', () => {
    expect(toNewNames(buildFolderPlan(['7 Alpha'], '{{index}} {{safeFolderName}}'))).toEqual(['1 Alpha']);
  });

  it('should zero-pad through the index mask', () => {
    expect(toNewNames(buildFolderPlan(['005. Alpha', '009. Beta'], '{{index:000}}. {{safeFolderName}}'))).toEqual([
      '001. Alpha',
      '002. Beta'
    ]);
  });

  it('should write the index as a suffix when the template puts it there', () => {
    expect(toNewNames(buildFolderPlan(['Alpha (9)'], '{{safeFolderName}} ({{index}})'))).toEqual(['Alpha (1)']);
  });

  it('should resolve the parent tokens', () => {
    expect(toNewNames(buildFolderPlan(['Alpha'], '{{parentFolder}} {{index}} - {{safeFolderName}}'))).toEqual([
      'Parent 1 - Alpha'
    ]);
  });

  it('should report the old and new paths, and the index it assigned', () => {
    expect(buildFolderPlan(['3. Alpha'])[0]).toEqual({
      baseName: 'Alpha',
      index: 1,
      newName: '1. Alpha',
      newPath: 'Root/Parent/1. Alpha',
      oldPath: 'Root/Parent/3. Alpha'
    });
  });

  it('should renumber a file on its basename and leave the extension alone', () => {
    expect(toNewNames(buildFilePlan(['9. Notes.md', 'Draft.canvas']))).toEqual(['1. Notes.md', '2. Draft.canvas']);
  });

  it('should keep the name unchanged when the template renders nothing at all', () => {
    // A template with no `{{index}}` cannot renumber, so the name comes back whole rather than emptied —
    // The settings validator refuses such a template, and this is what happens if one reaches here anyway.
    expect(toNewNames(buildFolderPlan(['3. Alpha'], ' '.repeat(3)))).toEqual(['3. Alpha']);
  });

  it('should join onto the vault root without a leading slash', () => {
    const plan = buildRenumberPlan({
      items: [{ extension: '', name: 'Alpha', path: 'Alpha' }],
      kind: ReorderItemKind.Folder,
      nameTemplate: FOLDER_NAME_TEMPLATE,
      parentFolder: '',
      parentFolderPath: '/'
    });
    expect(plan[0]?.newPath).toBe('1. Alpha');
  });
});

describe('buildRenameSteps', () => {
  function toSteps(names: readonly string[]): string[] {
    return buildRenameSteps({
      items: buildFolderPlan(names),
      resolveTemporaryPath: (desiredPath) => `${desiredPath} (reordering)`
    }).map((step) => `${step.fromPath} -> ${step.toPath}`);
  }

  it('should skip an item whose name does not change', () => {
    expect(toSteps(['1. Alpha', '2. Beta'])).toEqual([]);
  });

  it('should need no ordering at all when the base names differ, since no two destinations clash', () => {
    expect(toSteps(['2. Beta', '1. Alpha'])).toEqual([
      'Root/Parent/2. Beta -> Root/Parent/1. Beta',
      'Root/Parent/1. Alpha -> Root/Parent/2. Alpha'
    ]);
  });

  it('should rename into a name only once its current holder has moved away', () => {
    // Both carry the base name `Alpha`, so the unnumbered one is renamed INTO the name the numbered one
    // Still holds — it has to move first.
    expect(toSteps(['Alpha', '1. Alpha'])).toEqual([
      'Root/Parent/1. Alpha -> Root/Parent/2. Alpha',
      'Root/Parent/Alpha -> Root/Parent/1. Alpha'
    ]);
  });

  it('should break a two-item cycle with exactly one temporary rename', () => {
    expect(toSteps(['2. Alpha', '1. Alpha'])).toEqual([
      'Root/Parent/2. Alpha -> Root/Parent/1. Alpha (reordering)',
      'Root/Parent/1. Alpha -> Root/Parent/2. Alpha',
      'Root/Parent/1. Alpha (reordering) -> Root/Parent/1. Alpha'
    ]);
  });

  it('should break a three-item cycle with exactly one temporary rename', () => {
    const steps = toSteps(['3. Alpha', '1. Alpha', '2. Alpha']);
    expect(steps.filter((step) => step.includes('(reordering)'))).toHaveLength(2);
    expect(steps).toHaveLength(4);
  });

  it('should mark the temporary steps, so the caller can tell them from the real ones', () => {
    const steps = buildRenameSteps({
      items: buildFolderPlan(['2. Alpha', '1. Alpha']),
      resolveTemporaryPath: (desiredPath) => `${desiredPath} (reordering)`
    });
    expect(steps.map((step) => step.isTemporary)).toEqual([true, false, false]);
  });
});
