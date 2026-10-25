# axe-core test dependency

- Package: `axe-core`
- Version: 4.14.0
- License: MPL-2.0 (see LICENSE and LICENSE-3RD-PARTY.txt)
- Source: https://github.com/dequelabs/axe-core
- File: `axe.min.js` is the minified browser build used only by the Playwright
  test harness. It is injected into the page at test time and is not shipped by
  the production application.
- Why vendored: the local npm registry is blocked by the DSH network policy, so
  the accessibility engine is pinned as a test fixture instead of an installed
  package. The file is reproducible from the upstream tagged release.
