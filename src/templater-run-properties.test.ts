import {
  describe,
  expect,
  it
} from 'vitest';

import { applyPropertiesWrittenDuringRun } from './templater-run-properties.ts';

describe('applyPropertiesWrittenDuringRun', () => {
  it('should return the render untouched when the template wrote nothing', () => {
    const contentBeforeRun = '<%* nothing -%>\n# heading\n';
    expect(applyPropertiesWrittenDuringRun({
      contentAfterRun: contentBeforeRun,
      contentBeforeRun,
      renderedContent: '# heading\n'
    })).toBe('# heading\n');
  });

  it('should keep a property the template wrote while it ran', () => {
    // The `processFrontMatter` case: the note gained `aliases` mid-run, and the render — computed from the
    // Note as it stood before that — knows nothing about it.
    const result = applyPropertiesWrittenDuringRun({
      contentAfterRun: '---\naliases:\n  - A\n  - B\n---\n<%* … -%>\n# raw\n',
      contentBeforeRun: '<%* … -%>\n# raw\n',
      renderedContent: '# 1. A - B\n'
    });

    expect(result).toBe('---\naliases:\n  - A\n  - B\n---\n# 1. A - B\n');
  });

  it('should merge a written property into properties the render produced', () => {
    const result = applyPropertiesWrittenDuringRun({
      contentAfterRun: '---\ntitle: Original\naliases:\n  - A\n---\nbody\n',
      contentBeforeRun: '---\ntitle: Original\n---\nbody\n',
      renderedContent: '---\ntitle: Rendered\n---\nbody\n'
    });

    // The render owns `title` — it was never touched during the run — while `aliases` is carried over.
    expect(result).toBe('---\ntitle: Rendered\naliases:\n  - A\n---\nbody\n');
  });

  it('should drop a property the template deleted', () => {
    const result = applyPropertiesWrittenDuringRun({
      contentAfterRun: '---\nkeep: yes\n---\nbody\n',
      contentBeforeRun: '---\nkeep: yes\ngone: true\n---\nbody\n',
      renderedContent: '---\nkeep: yes\ngone: true\n---\nbody\n'
    });

    expect(result).toBe('---\nkeep: yes\n---\nbody\n');
  });

  it('should drop the properties block entirely when nothing is left in it', () => {
    const result = applyPropertiesWrittenDuringRun({
      contentAfterRun: 'body\n',
      contentBeforeRun: '---\ngone: true\n---\nbody\n',
      renderedContent: '---\ngone: true\n---\nbody\n'
    });

    expect(result).toBe('body\n');
  });

  it('should ignore a mid-run edit that changed no property', () => {
    // The render stays authoritative for the note's TEXT: a template that rewrites its own body while
    // Rendering it has no coherent answer, so the body written mid-run is discarded.
    const result = applyPropertiesWrittenDuringRun({
      contentAfterRun: 'appended by the template\n',
      contentBeforeRun: 'original\n',
      renderedContent: 'rendered\n'
    });

    expect(result).toBe('rendered\n');
  });

  it('should treat a rewritten list as a change', () => {
    const result = applyPropertiesWrittenDuringRun({
      contentAfterRun: '---\naliases:\n  - A\n  - B\n---\nbody\n',
      contentBeforeRun: '---\naliases:\n  - A\n---\nbody\n',
      renderedContent: '---\naliases:\n  - A\n---\nbody\n'
    });

    expect(result).toBe('---\naliases:\n  - A\n  - B\n---\nbody\n');
  });
});
