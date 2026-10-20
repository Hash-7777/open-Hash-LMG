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

The window holds only the permissions the page uses
(`src-tauri/capabilities/default.json`), and the check above keeps the page's
commands and the Rust side's in step.

## Code written by a model

In the Code way of working, a model writes its own drawing code. It is read
first and refused, with a reason the model is told, if it reaches for the
network, storage, timers, the clock, other threads or the page
(`src/core/director/code-check.js`). It then runs only inside a worker from
which every way to reach the network, storage or other threads has been
removed before the code is loaded (`src/render/lockdown.js`). A frame that
does not come back in time stops that worker and starts a fresh one
(`src/render/host.js`).

## What is not done yet

- The app is not signed or notarised. macOS will warn the first time it is
  opened.
- Keys are not encrypted at rest.
