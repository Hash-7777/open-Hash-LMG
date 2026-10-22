# Security

What Hash LMG protects, how, and where its protections stop. Every statement
here points at the code that makes it true.

## Where your keys live

Keys for cloud model services are kept in the app's own web storage on this
computer (`src/platform/settings.js`), in an entry of their own, apart from
every other setting, so settings can be shown or reset without a key moving
with them. In the desktop app that storage sits in the app's data folder,
keyed by the identifier `com.hashlmg.app`. **It is not encrypted.** Anyone
who can read your user folder can read the keys. A key is sent only to the
service it belongs to, with each request (`src/core/providers/request.js`).

## Where requests go

There is no account and no server of ours. The desktop app's content policy
(`src-tauri/tauri.conf.json`) lets the page reach:

- the cloud model services listed in `src/core/providers/catalog.js`, and
  nothing else on the internet;
- `127.0.0.1` and `localhost` on any port, for model and speech servers
  running on your own computer.

`scripts/checks/policy.mjs` fails if the policy and the list of services
drift apart in either direction.

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
  dialog and remembered by an id in a list in the app's data folder; the
  page never sees a path. The window reads a file through the app's own
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
- **Model servers a web page may not ask** (LM Studio and llama.cpp on this
  computer, Moonshot in the cloud) are asked by the desktop side instead. The
  page names the service, the route (chat or models) and, on this computer,
  a port from 1024 up; the address comes from a fixed table, no part of it
  from the page, and redirects are not followed. The person's own key goes
  in one header to that one host.
- **Encoding** is done by encoders built into the app (H.264, GIF, MP3). The
  page sends raw pixels or sound under a session token and gets encoded
  bytes back; these commands read and write no file and take no path. Frame
  sizes are bounded (even sides, up to 4K).
- The **run history** (Settings, Run history) keeps each run's brief,
  settings, steps, and every question to the model with its answer, in the
  web view's own database on this computer, the newest 60 runs. Keys are
  never part of a run, and a picture sent to a model is noted by its size,
  not kept. A run leaves the computer only when saved as Markdown.
- A **debug build** started with `LMG_SELFTEST` naming a script runs that
  script in its window each time the page loads, for testing the app end to
  end. Release builds do not contain this.

The window holds only the permissions the page uses
(`src-tauri/capabilities/default.json`): placing, sizing and showing its own
window, which opens hidden so it can be placed before it is seen
(`src/platform/window.js`), dragging it by its top bar, and opening a web
link in the system browser. The check above keeps the page's commands and
the Rust side's in step.

## Code written by a model

In the Code way of working, a model writes its own drawing code. It is read
first and refused, with a reason the model is told, if it reaches for the
network, storage, timers, the clock, other threads or the page
(`src/core/director/code-check.js`). It then runs only inside a worker from
which every way to reach the network, storage or other threads has been
removed before the code is loaded (`src/render/lockdown.js`). A frame that
does not come back in time stops that worker and starts a fresh one
(`src/render/host.js`).

## Pictures drawn by a model

A picture a model draws is read as path data only: drawing commands and
numbers, nothing else (`src/core/scene/pictures.js`). It is flattened to
straight segments, fitted to its grid and drawn by the app's own renderer,
like any other shape. A drawing with anything else in it is set aside.

## What is not done yet

- The app is not signed or notarised. macOS will warn the first time it is
  opened.
- Keys are not encrypted at rest.
