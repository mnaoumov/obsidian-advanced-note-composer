import type { ObsidianPluginVitestConfigContext } from 'obsidian-dev-utils/script-utils/test-runners/vitest-config';
import type { TestProjectConfiguration } from 'vitest/config';

import { defineObsidianPluginVitestConfig } from 'obsidian-dev-utils/script-utils/test-runners/vitest-config';

/**
 * The screenshot-capture suites (T461-P21) that write `images/screenshot-*.png`.
 *
 * They are named `*.desktop-capture.` / `*.android-capture.` rather than
 * `*.desktop.` / `*.android.` so they match NONE of the standard project globs.
 * That keeps them out of `npm run test:integration` entirely — capturing is an
 * explicit operation (`npm run capture:screenshots`), not something every test
 * run does. Folding them into the standard projects would rewrite five PNGs on
 * every run and dirty the tree mid-release.
 */
const DESKTOP_CAPTURE_TEST_FILES = 'src/**/*.desktop-capture.integration.test.ts';
const ANDROID_CAPTURE_TEST_FILES = 'src/**/*.android-capture.integration.test.ts';

/**
 * The AVD the mobile shots are taken on: 900x1600 at density 320, which is
 * exactly the size the community store asks for, so the capture needs no crop,
 * no rescale and no letterbox. The shared `obsidian_test` AVD is a Pixel 10 Pro
 * XL at 1344x2994 (~9:20) and cannot produce it; resizing that one at runtime
 * destroys the Appium session, because the display change recreates the
 * activity and with it the WebView the session is attached to.
 *
 * Needs one-time provisioning — see [[T461-P21]]. Briefly: the harness never
 * installs the Obsidian APK, and because it launches emulators with
 * `-no-snapshot-save`, an install done under that flag is silently discarded.
 * Boot WITHOUT that flag, install, launch Obsidian once, then `adb emu kill`.
 */
const SCREENSHOT_AVD_NAME = 'obsidian_screenshots';

const APPIUM_URL = 'http://localhost:4723';

/**
 * This AVD is cold-booted and rarely used, so Obsidian's first layout on it is
 * far slower than on the well-warmed shared one; the 90s default expires while
 * it is still starting up.
 */
const LAYOUT_READY_TIMEOUT_IN_MILLISECONDS = 240_000;

/**
 * The demo-vault button suite. It drives a real desktop Obsidian like the desktop project, but opens
 * a copy of the in-repo `demo-vault/` rather than an empty vault — hence its own `globalSetup` — and
 * needs its own suffix so the desktop project does not also collect it and open it against a vault
 * with no notes in it.
 */
const DEMO_VAULT_TEST_FILES = 'src/**/*.demo-vault.integration.test.ts';

/**
 * One `it` per note runs every button in that note, and each button re-opens the note, walks the
 * preview to find itself and then waits up to 15s for a result. A note with a dozen buttons therefore
 * blows well past the desktop project's 30s default — which fails the whole note with a bare vitest
 * timeout instead of naming the button that actually misbehaved.
 */
const DEMO_VAULT_TIMEOUT_IN_MILLISECONDS = 600_000;

/**
 * Per-file cleanup for every project that drives a real desktop Obsidian. The whole project shares one
 * instance and one vault, so a test that throws with a modal open hands the next file a covered app — the
 * cascade [[T795-P12]] measured, where one failure was followed by 28 consecutively failing files that all
 * pass in isolation. Appended here rather than in 101 test files so no new suite can forget it.
 */
const INTEGRATION_TEST_SETUP_FILE = './scripts/integration-test-setup.ts';

/**
 * Per-file vault cleanup, emptying the shared temp vault before each file so no file inherits another's
 * notes ([[T880-P12]]). Appended beside the modal cleanup rather than folded into it, because the two have
 * different audiences: `withoutVaultReset` below takes this one back off the projects that OWN the contents
 * of their vault, while leaving them the modal cleanup they still need.
 */
const INTEGRATION_TEST_VAULT_RESET_FILE = './scripts/integration-test-vault-reset.ts';

/**
 * Normalizes vitest's `string | string[]` setup-file field so a new entry can be appended without
 * assuming which shape the shared configuration used.
 *
 * @param setupFiles - The project's current setup files.
 * @returns The setup files as an array.
 */
function toSetupFileList(setupFiles: string | string[] | undefined): string[] {
  if (setupFiles === undefined) {
    return [];
  }

  return Array.isArray(setupFiles) ? setupFiles : [setupFiles];
}

/**
 * The desktop setup files minus the vault reset, for a project whose vault is pre-populated with the very
 * thing it tests.
 *
 * `editContext` runs BEFORE `customProjects`, so every project spreading `context.desktop` picks the reset up
 * by default — which is what makes it forgettable-proof, and why opting out has to be explicit.
 *
 * @param setupFiles - The project's current setup files.
 * @returns The setup files without the vault reset.
 */
function withoutVaultReset(setupFiles: string | string[] | undefined): string[] {
  return toSetupFileList(setupFiles).filter((setupFile) => setupFile !== INTEGRATION_TEST_VAULT_RESET_FILE);
}

export const config = defineObsidianPluginVitestConfig({
  customProjects(context: ObsidianPluginVitestConfigContext): TestProjectConfiguration[] {
    return [
      {
        test: {
          ...context.desktop,
          include: [DESKTOP_CAPTURE_TEST_FILES],
          name: 'capture-screenshots:desktop',
          // Capturing is what these suites are FOR: emptying the vault under them would change the PNGs
          // They write into `images/`, which is a committed artifact and no part of T880's subject.
          setupFiles: withoutVaultReset(context.desktop.setupFiles)
        }
      },
      {
        test: {
          ...context.android,
          environmentOptions: {
            obsidianTransport: {
              appiumUrl: APPIUM_URL,
              avdName: SCREENSHOT_AVD_NAME,
              layoutReadyTimeoutInMilliseconds: LAYOUT_READY_TIMEOUT_IN_MILLISECONDS,
              type: 'obsidian-android-appium'
            }
          },
          include: [ANDROID_CAPTURE_TEST_FILES],
          name: 'capture-screenshots:android'
        }
      },
      {
        test: {
          ...context.desktop,
          globalSetup: ['./scripts/demo-vault-global-setup.ts'],
          include: [DEMO_VAULT_TEST_FILES],
          name: 'integration-tests:demo-vault',
          /*
           * Load-bearing, not tidiness: this project's `globalSetup` pre-populates the whole `demo-vault/`
           * tree, which is the thing under test, so the reset would delete the subject before the first file
           * ran. It is reached by `npm run test:integration`, so getting this wrong empties a real run.
           */
          setupFiles: withoutVaultReset(context.desktop.setupFiles),
          testTimeout: DEMO_VAULT_TIMEOUT_IN_MILLISECONDS
        }
      }
    ];
  },
  editContext(context: ObsidianPluginVitestConfigContext): void {
    /*
     * Mutating `context.desktop` BEFORE `customProjects` runs is what carries the cleanup into the
     * projects that spread it — `integration-tests:demo-vault` and `capture-screenshots:desktop` drive the
     * same shared instance and inherit the same hazard. The android project is deliberately left alone:
     * its two cross-platform files have never shown the cascade, and an untested Appium round-trip in
     * every `afterEach` would be a change nothing here has measured.
     *
     * The two entries differ in how far that inheritance is wanted. The MODAL cleanup applies to every
     * project spreading `context.desktop` without exception — a covered app is a hazard wherever it happens.
     * The VAULT reset does not: both custom desktop projects own the contents of their vault, so each takes
     * it back off with `withoutVaultReset`. Appending it here anyway rather than adding it to one project is
     * what keeps the default safe — a new project inherits the isolation and opts out visibly.
     */
    context.desktop.setupFiles = [
      ...toSetupFileList(context.desktop.setupFiles),
      INTEGRATION_TEST_SETUP_FILE,
      INTEGRATION_TEST_VAULT_RESET_FILE
    ];
  }
});
