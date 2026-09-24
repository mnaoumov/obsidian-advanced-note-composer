import process from 'node:process';
import { registerDemoVaultCoverageSuite } from 'obsidian-dev-utils/script-utils/demo-vault-coverage';
import { getRootFolder } from 'obsidian-dev-utils/script-utils/root';

// Keeps the in-repo `demo-vault/` in sync with the plugin's public surface WITHOUT
// launching Obsidian: it reflects the real config from source and asserts every
// setting is documented in a note, and that the guard note/member still exist
// (rename drift). The vault IS this plugin's documentation, so nothing else checks
// that a setting reaches a reader; the plugin's runtime behavior is covered by the
// desktop integration tests.
registerDemoVaultCoverageSuite({
  authoring: {
    // `Materials/` is the data the walkthroughs operate on, not part of the learning path, so its
    // deeper notes are not reachable from `00 Start.md` and are not meant to be. The ones listed here
    // exist only to give a command something to act on.
    excludedNotes: [
      'README.md',
      'Materials/17 Swap file/Swap examples/Folder A/Note A.md',
      'Materials/17 Swap file/Swap examples/Folder B/Note B.md',
      'Materials/21 Move folder to/Move destination/Already here.md',
      'Materials/22 Create folder with notes/Create example/1. Existing/Existing note.md',
      'Materials/23 Reorder folders/Reorder example/1. Alpha/!.md',
      'Materials/23 Reorder folders/Reorder example/2. Beta/!.md',
      'Materials/23 Reorder folders/Reorder example/3. Gamma/!.md',
      'Materials/24 Rename folder/Rename example/1. Quarterly Report/!.md',
      'Materials/24 Rename folder/Rename example/2. Roadmap/!.md',
      'Materials/27 Relative links/Relative links/Subfolder/Deep note.md',
      /*
       * The recursive fixture cannot open with an `# H1` the way every other note does, and that is the
       * feature rather than an oversight: a recursive split starts at the SHALLOWEST heading the note has,
       * so a title would be the first thing extracted and the tree would come out rooted in a folder named
       * after it instead of in `D` and `F`. It IS reached from the walkthrough; only the H1 rule cannot
       * apply.
       */
      'Materials/40 Auto-number splits/Folder example/Recursive source.md',
      // The already-numbered neighbors the auto-numbering reads its `1 + max` from. They are the
      // background of the two sources the walkthrough DOES link, and nothing is done to them.
      'Materials/40 Auto-number splits/Folder example/1. A/!.md',
      'Materials/40 Auto-number splits/Folder example/3. B/!.md',
      'Materials/40 Auto-number splits/Folder example/4. C/!.md',
      'Materials/40 Auto-number splits/Note example/1. A.md',
      'Materials/40 Auto-number splits/Note example/3. B.md',
      'Materials/40 Auto-number splits/Note example/4. C.md',
      // The same background for issue #273: the already-numbered neighbors a relocated item reads its
      // `1 + max` from, plus the one note that travels INSIDE a promoted folder. The walkthrough links the
      // two notes the reader actually opens; nothing is done to these.
      'Materials/41 Auto-number moves/Flatten example/1. Existing/!.md',
      'Materials/41 Auto-number moves/Flatten example/2. First note.md',
      'Materials/41 Auto-number moves/Flatten example/3. Another/!.md',
      'Materials/41 Auto-number moves/Flatten example/5. Second note.md',
      'Materials/41 Auto-number moves/Flatten example/Source folder/3. Numbered child/Deep.md',
      'Materials/41 Auto-number moves/Move example/Destination/1. Alpha/!.md',
      'Materials/41 Auto-number moves/Move example/Destination/3. Gamma/!.md'
    ]
  },
  configInterfaces: [{ interfaceName: 'PluginSettings', sourcePath: 'src/plugin-settings.ts' }],
  interfaces: [],
  nonTrivialGuard: {
    expectDemoNote: '09 Titles, links and frontmatter/30 Frontmatter merge strategy.md',
    expectMember: 'defaultFrontmatterMergeStrategy',
    interfaceName: 'PluginSettings',
    sourcePath: 'src/plugin-settings.ts'
  },
  rootFolder: getRootFolder() ?? process.cwd()
});
