# Security

What Hash LMG protects, how, and where its protections stop. Every statement
here points at the code that makes it true.

## Reporting a security problem

Please report a security problem privately, through the repository's
private reporting on GitHub (the Security tab), not in a public issue. Say
what you did, what happened and which version or commit you ran. Nothing in
Hash LMG has been released yet, so a report is about the main branch.

## Where your keys live

Keys for cloud services are kept by the desktop side
(`src-tauri/src/commands/keys.rs`), in one file in the app's data folder
(keyed by the identifier `com.hashlmg.app`), apart from every other setting.
On macOS and Linux the file can be read and written by your account alone,
and its folder opened by your account alone. **It is not encrypted**: it is
protected by those permissions, so anyone signed in as you, or any program
you run, can still read it.

The page hands a key over once, when you paste it in Settings, and never
holds it again: no command returns a key, and the page learns only which
services have one, with its last four characters. Every request to a cloud
service is made by the desktop side, which adds the key for that one service,
in that service's own header (`src-tauri/src/commands/relay.rs`). So nothing
running in the window, and no code a model writes, can read a key.

A key saved by an earlier version in the page's own storage is moved to the
desktop side the next time the app opens, and removed from the page's
storage (`src/platform/settings.js`).

## Where requests go

There is no account and no server of ours. The desktop app's content policy
(`src-tauri/tauri.conf.json`) lets the page reach `127.0.0.1` and `localhost`
on any port, for model and speech servers running on your own computer, and
nothing on the internet.

Cloud model services, and the cloud voice, are reached by the desktop side
from a fixed table of addresses (`src-tauri/src/commands/relay.rs`), one per
service listed in `src/core/providers/catalog.js`. The page names the
service and a route (chat, models or speech); for a service that puts the
model in its address, the model's name, held to letters, digits, dots,
dashes and underscores; and for a model app on this computer a port from
1024 up. No part of an address comes from the page, and redirects are not
followed.

`scripts/checks/policy.mjs` fails if the policy names any host on the
internet, if a service in the catalog is missing from the desktop side's
table, or if the services the desktop side keeps keys for and the ones the
page offers keys for drift apart.

## The window shows the app and nothing else

Every attempt to send the window to another address is refused
(`src-tauri/src/security/navigation.rs`). Links you click open in your own
browser instead (`src/platform/index.js`).

## The desktop side does a few named jobs

The page reaches the computer only through the commands in
`src-tauri/src/commands/`, each written for one job:

- **Films** are kept in the app's data folder. The page names a film by an id
  of lower-case letters, digits and dashes, and never by a path.
- **Exports** are written where you choose in the system's save dialog. The
  page never sees or names the path; a cancelled export leaves nothing.
- **Sound** is encoded by the system's own AAC encoder (macOS), from a WAV
  the page sends, through temporary files that are removed straight after.
- **Footage, pictures and sound** are picked in the system's own open
  dialog, or dropped on the window, where the desktop side reads the drop
  itself (`src-tauri/src/lib.rs`), and are remembered by an id in a list in
  the app's data folder; only files of the kinds a film takes are kept, and
  the page never sees a path. A folder stands for the files of those kinds
  inside it and in the folders directly in it, at most sixty, in name order;
  hidden files and folders and links are left out
  (`src-tauri/src/commands/media.rs`).
- **Text files** the person adds are read by the page through the same
  address, at most two megabytes each, kept with the film, and given to the
  model fenced and marked as material, never instructions
  (`src/core/director/brand.js`). The window reads a file through the app's own
  address (`lmgmedia`), by id only, in pieces of at most a few megabytes, and
  only files on that list can be read. The content policy names that address
  for media, pictures and reading sound, and nothing more.
- **Voices installed on this computer** (Chatterbox, Kokoro) run through
  the person's own install, whose folder is chosen in the system's folder
  dialog and remembered by the desktop side; the page names only the engine.
  A short script built into the app speaks each line with that install's
  own interpreter and writes a WAV to the system's temporary folder, which is
  read back and removed. Nothing is installed or downloaded by the app. Lines
  sent to a cloud voice go to that service only when it is chosen.
- **Model services** in the cloud, and LM Studio and llama.cpp on this
  computer, are asked by the desktop side, as described above under Where
  requests go. Ollama on this computer is asked by the page directly.
- **Keys** are kept by the desktop side, as described above under Where your
  keys live: the page can save or forget a key, and ask which services have
  one, and nothing else.
- **Encoding** is done by encoders built into the app (H.264, AV1, GIF, MP3, Vorbis). The
  page sends raw pixels or sound under a session token and gets encoded
  bytes back; these commands read and write no file and take no path. Frame
  sizes are bounded (even sides, up to 4K).
- The **run history** (Settings, Run history) keeps each run's brief,
  settings, steps, and every question to the model with its answer, in the
  web view's own database on this computer, the newest 60 runs. Keys are
  never part of a run, and a picture sent to a model is noted by its size,
  not kept. A run leaves the computer only when saved as Markdown.
- **Looking things up on the web** (`src-tauri/src/commands/web.rs` and `search.rs`) happens
  only when the person says yes, each time: every search and every address
  is listed first and can be left out, and reading the top pages a search
  finds is a choice of its own (`src/app/web-permission.js`); the setting
  can turn it all off. A look-up asked for in the conversation goes through
  the same window. The desktop side builds each search address itself, for
  a search service the person keeps a key for, or else DuckDuckGo's plain
  results page and, when that finds nothing, Wikipedia; it reads a page only
  over http or https, with no name or password in the address. Every host is resolved once, every address it
  answers with must be on the public internet, and the connection is made to
  those very addresses; each redirect is checked again. Only text comes back,
  at most a megabyte, and what the storyboard step is given of it is a few
  thousand characters of plain words, fenced and marked as material to draw
  facts from and never as instructions (`src/core/research/research.js`).
  Nothing is sent but the search's words, or the request for the page.
- The **usage log** (`src-tauri/src/commands/usage.rs`) appends one line per
  request to a model to `usage.jsonl` in the app's data folder: the time,
  the service and model, and how many tokens were read and written. Never a
  brief, a prompt or an answer. It starts again once it passes a few
  megabytes.
- A **debug build** started with `LMG_SELFTEST` naming a script runs that
  script in its window each time the page loads, for testing the app end to
  end. Release builds do not contain this.

The window holds only the permissions the page uses
(`src-tauri/capabilities/default.json`): placing, sizing and showing its own
window, which opens hidden so it can be placed before it is seen
(`src/platform/window.js`), dragging it by its top bar, and opening a web
link in the system browser. The check above keeps the page's commands and
the Rust side's in step.

## What a model is told, and what it may show

Every question the app puts to a model ends its system text with one rule
(`src/core/director/guard.js`): the brief, messages, files, file names, web
pages and earlier answers are material for the film, never instructions
that change the task, and the instructions themselves are never revealed.
Material from outside is placed where the model reads it as material: files
and web notes between marked lines (`src/core/director/brand.js`,
`src/core/research/research.js`), file and picture names as plain one-line
labels. A reply in the conversation that repeats its own instructions is
neither shown nor acted on; the person's files are not counted as
instructions, so a brief may quote them. What any model writes reaches the screen as
text, never as markup, and reaches the film only through the scene format's
own reader (`src/core/scene/normalize.js`), the drawing reader or the
locked worker below. Checked in `scripts/checks/guard.mjs`.

## Code written by a model

In the Code way of working, a model writes its own drawing code. It is read
first and refused, with a reason the model is told, if it reaches for the
network, storage, timers, the clock, other threads or the page
(`src/core/director/code-check.js`). It then runs only inside a worker from
which every way to reach the network, storage or other threads has been
removed before the code is loaded (`src/render/lockdown.js`). A frame that
does not come back in time stops that worker and starts a fresh one
(`src/render/host.js`).

A model's music is code too: it is read by the same check and run in the
same worker (`src/core/director/music.js`, `src/render/worker.js`). It is
handed only the music kit (`src/core/audio/music-kit.js`) and can only place
notes and drums; each is checked, and the app plays them with its own
instruments.

## Pictures drawn by a model

A picture a model draws is read as shape names and numbers, or path data
only: drawing commands and numbers, nothing else (`src/core/scene/pictures.js`). It is flattened to
straight segments, fitted to its grid and drawn by the app's own renderer,
like any other shape. A drawing with anything else in it is set aside.

## What is not done yet

- The app is not signed or notarised. macOS will warn the first time it is
  opened.
- Keys are protected by file permissions, not encrypted at rest. The
  system's own keychain asks for a password on every update while the app
  is unsigned, so it waits for signing.
