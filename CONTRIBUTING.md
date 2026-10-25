# Contributing to Hash LMG

Thank you for helping. Hash LMG is plain JavaScript (ES modules, no bundler)
for the editor and the film engine, and Rust for the desktop side. These are
the few rules the code keeps; the checks hold most of them for you.

## Before a pull request

- Run `npm run check`. Every script in `scripts/checks/` runs, and a new
  check you add there runs from the moment it exists.
- When anything under `src-tauri/` changed, run `cargo test` and
  `cargo clippy --all-targets -- -D warnings` in `src-tauri/`.
- Turn on the repository's hooks once per clone:
  `git config core.hooksPath .githooks`. They stop a commit that carries a
  key, a private note or build output, and a message with an emoji in it.

## How the code is kept

- **`src/core/` is pure.** No page, no network, no storage: the checks run
  it in Node. Anything that touches the page lives in `src/app/`,
  `src/platform/` or `src/render/`.
- **The scene format is a promise to saved films.** A new field of a scene,
  scene item or layer is added to `normalizeScene` and to the field guard in
  `scripts/checks/scene-normalize.mjs` in the same change. A change that
  would break saved films needs a new format version and a migration.
- **The content policy and the app's permissions are security.** Widening
  either (`src-tauri/tauri.conf.json`, `src-tauri/capabilities/`) is
  explained in the pull request and in `docs/SECURITY.md`.
- **Model-written code stays locked.** `src/render/lockdown.js` keeps it
  away from the network and storage; changes there need a reason and a check.
- **What the docs say, the code does.** A claim in the README or `docs/`
  points at the code that makes it true, and a change of behaviour updates
  the claim in the same pull request. Numbers are measured, not guessed.
- **No emoji, anywhere,** in the app, code, prompts, docs or commits. A mark
  that is needed is drawn as an SVG.
- **No other product is named** in what the app ships. Describe the kind of
  tool instead ("video editing apps"). The model services and voice engines
  the app connects to are named, since a person needs those names to set
  it up.
- **Test data is invented.** Names, addresses, numbers and keys in checks
  are made up, never taken from a real person or company.
- **Files stay readable.** `scripts/checks/file-size.mjs` gives each source
  file a budget; a file that outgrows it is doing two jobs and is split.

## Licence

Hash LMG is licensed under the GNU General Public License, version 3 or
later. By contributing, you agree that your contribution is licensed the
same way.
