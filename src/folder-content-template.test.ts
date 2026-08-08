import {
  describe,
  expect,
  it
} from 'vitest';

import {
  DEFAULT_NOTE_NAME_TEMPLATE,
  parseFolderContentTemplate
} from './folder-content-template.ts';

describe('parseFolderContentTemplate', () => {
  describe('without a marker', () => {
    it('should produce one note named after the folder for an empty template', () => {
      expect(parseFolderContentTemplate('')).toEqual([{
        contentTemplate: '',
        nameTemplate: DEFAULT_NOTE_NAME_TEMPLATE
      }]);
    });

    it('should keep the whole template as that note\'s content', () => {
      expect(parseFolderContentTemplate('# {{folderName}}\n\nbody')).toEqual([{
        contentTemplate: '# {{folderName}}\n\nbody\n',
        nameTemplate: DEFAULT_NOTE_NAME_TEMPLATE
      }]);
    });
  });

  describe('with markers', () => {
    it('should split the template at each marker line', () => {
      const sections = parseFolderContentTemplate('{{file}} !.md\nfirst\n{{file}} second.md\nsecond');
      expect(sections).toEqual([
        { contentTemplate: 'first\n', nameTemplate: '!.md' },
        { contentTemplate: 'second\n', nameTemplate: 'second.md' }
      ]);
    });

    it('should keep tokens inside a name unresolved for the caller', () => {
      // The name may itself contain tokens; nothing nests, because the marker is a bare `{{file}}` and the
      // Name is simply the rest of the line.
      const sections = parseFolderContentTemplate('{{file}} {{safeFolderName}}.md\n# {{folderName}}');
      expect(sections).toEqual([{
        contentTemplate: '# {{folderName}}\n',
        nameTemplate: '{{safeFolderName}}.md'
      }]);
    });

    it('should allow leading whitespace before the marker', () => {
      const sections = parseFolderContentTemplate('   {{file}} a.md\nbody');
      expect(sections).toEqual([{ contentTemplate: 'body\n', nameTemplate: 'a.md' }]);
    });

    it('should match the marker case-insensitively', () => {
      const sections = parseFolderContentTemplate('{{FILE}} a.md\nbody');
      expect(sections).toEqual([{ contentTemplate: 'body\n', nameTemplate: 'a.md' }]);
    });

    it('should fall back to the default name when the marker names nothing', () => {
      const sections = parseFolderContentTemplate('{{file}}\nbody');
      expect(sections).toEqual([{ contentTemplate: 'body\n', nameTemplate: DEFAULT_NOTE_NAME_TEMPLATE }]);
    });

    it('should produce an empty note for a marker with no content', () => {
      const sections = parseFolderContentTemplate('{{file}} a.md\n{{file}} b.md\nbody');
      expect(sections).toEqual([
        { contentTemplate: '', nameTemplate: 'a.md' },
        { contentTemplate: 'body\n', nameTemplate: 'b.md' }
      ]);
    });

    it('should not treat a mid-line {{file}} as a marker', () => {
      // It stays an ordinary token, which the resolver rejects as an unknown key — the existing behavior.
      const sections = parseFolderContentTemplate('text {{file}} more');
      expect(sections).toEqual([{ contentTemplate: 'text {{file}} more\n', nameTemplate: DEFAULT_NOTE_NAME_TEMPLATE }]);
    });
  });

  describe('text before the first marker', () => {
    it('should become its own leading note', () => {
      const sections = parseFolderContentTemplate('intro\n{{file}} a.md\nbody');
      expect(sections).toEqual([
        { contentTemplate: 'intro\n', nameTemplate: DEFAULT_NOTE_NAME_TEMPLATE },
        { contentTemplate: 'body\n', nameTemplate: 'a.md' }
      ]);
    });

    it('should be dropped when it is blank, so a leading newline creates no stray note', () => {
      const sections = parseFolderContentTemplate('\n{{file}} a.md\nbody');
      expect(sections).toEqual([{ contentTemplate: 'body\n', nameTemplate: 'a.md' }]);
    });
  });

  describe('content normalization', () => {
    it('should end every non-empty note with exactly one newline', () => {
      // Otherwise an inner note would lose the newline the next marker line consumed, while the last note
      // Kept the template's own trailing one.
      const sections = parseFolderContentTemplate('{{file}} a.md\nalpha\n\n\n{{file}} b.md\nbeta\n');
      expect(sections).toEqual([
        { contentTemplate: 'alpha\n', nameTemplate: 'a.md' },
        { contentTemplate: 'beta\n', nameTemplate: 'b.md' }
      ]);
    });

    it('should leave an empty note empty rather than adding a newline', () => {
      expect(parseFolderContentTemplate('{{file}} a.md\n\n\n')).toEqual([{ contentTemplate: '', nameTemplate: 'a.md' }]);
    });
  });

  it('should reproduce the reporter\'s own two-note layout', () => {
    const sections = parseFolderContentTemplate([
      '{{file}} !.md',
      '---',
      'title: "{{folderName}}"',
      '---',
      '',
      '- [ ] refine',
      '{{file}} {{safeFolderName}}.md',
      '# {{folderName}}'
    ].join('\n'));

    expect(sections).toEqual([
      { contentTemplate: '---\ntitle: "{{folderName}}"\n---\n\n- [ ] refine\n', nameTemplate: '!.md' },
      { contentTemplate: '# {{folderName}}\n', nameTemplate: '{{safeFolderName}}.md' }
    ]);
  });
});
