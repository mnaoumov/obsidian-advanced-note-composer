import { registerDemoVaultButtonSuite } from '@mnaoumov/obsidian-dev-toolkit/demo-vault-buttons';

// Clicks every `code-button` in `demo-vault/` against a real Obsidian.
// A button's failure happens at click time — a wrong `require('/demoSetup.ts')` path, or an API that
// changed shape under it — so no other gate in this repo can catch it.
// `lint:md` reads the markdown and the coverage suite checks the authoring conventions, and neither
// executes anything.
//
// Isolation: `npx vitest run --project integration-tests:demo-vault`.
//
// Most `Try it` buttons run a command that opens a picker or a confirmation dialog and leaves it for the
// reader. Closing it after each click keeps one dialog from sitting over every note that runs after it.
registerDemoVaultButtonSuite({ shouldDismissModals: true });
