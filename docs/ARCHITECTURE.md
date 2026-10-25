# Architecture

Hash LMG is a Tauri v2 desktop app. The page (plain JavaScript ES modules, no
bundler, no framework) does almost everything: the editor, talking to models,
directing and laying out films, drawing frames and writing files. The desktop
side (Rust, `src-tauri/`) does only what a web page cannot or should not:
keep films and remembered files in the app's own folder, show the system's
open and save dialogs, read imported media in pieces, encode video and sound
with encoders built into the app, run an installed voice, keep the keys for
cloud services, and make every request to a cloud service, adding its key.

The same page also runs in a plain browser while it is built and checked.
Everything that differs between the two goes through `src/platform/index.js`.

## The way a film is made

The person talks with the director in the left panel
(`src/app/chat-panel.js`, `src/core/director/chat.js`): each turn sends a short
system text, the film's state in a few lines and the last few messages, and
the reply either asks a few questions with answers to tap, or writes the
brief and the film's settings, or names a change to an existing film. Then:

```
brief
  -> research (asked)    the model names what it would look up; with the person's
                         yes, the desktop side searches and reads pages, and a few
                         thousand characters of notes go to the storyboard step
  -> storyboard          the model writes words and numbers, beat by beat
  -> pictures            the model draws the few things the film is about;
                         each drawing is checked and fitted, or set aside
  -> direction           look, colour, tempo, key, motion, composition, from the brief;
                         a beat with a drawing takes a composition built around it
  -> layout              the compiler lays the beats out and times them to the beat
  -> design (optional)   a mid-size model redesigns the plan a few scenes at a time
                         (src/core/director/design.js), or a strong one writes code
  -> checks              frames are measured at rest, mid-move and on every beat;
                         what rules can repair, they repair; the rest goes back once
  -> brief check         what the brief asked to see is measured on the drawn film
  -> review (optional)   a model that can see reads a contact sheet and asks for changes
  -> music               the model composes the score as code with the music kit; it
                         runs locked down and only places notes, which the app plays
  -> narration           each line spoken in the chosen voice and timed word by word,
                         then laid over the film as one script (src/core/scene/narration-timing.js)
  -> film                score, sound and frames, encoded and written to a file
```

`src/core/director/pipeline.js` runs these steps. It is pure orchestration:
the model, the renderer and the log are passed in, so the checks run it end
to end with a scripted model and a stand-in canvas.

Each service's reply says what the request used; `src/core/providers/request.js`
reads it into one shape, the run record keeps it per request, and the desktop
app appends it, as counts only, to `usage.jsonl` in its data folder
(`src-tauri/src/commands/usage.rs`), where token counters on the computer can
read it.

## Source

```
src/
  index.html, css/       the editor window
  core/                  pure modules with no page access; the checks run them in Node
    scene/               the scene format (lmg.scene/1) and its normaliser, assets and
                         value cleaners, the storyboard, the direction, the compositions,
                         the pictures and the compositions built around them,
                         the person's own media and the compositions that show it,
                         the compiler, narration laid over the film as one script,
                         the film checks and when they look, editing helpers,
                         templates and examples
    engine/              easing, keyframes, paths, the drawing kit, entrances and exits,
                         the carry transition, repeated layers, the odometer, the renderer
    director/            the conversation, the person's brand files, the prompts and the rule every one ends with,
                         the pipeline, the drawing step, the composing step,
                         the brief check, the code check, the scene helpers, the run record
    research/            what to look up, a page read as text, the notes
    providers/           the model services, request and stream shapes, local model
                         sessions, model profiles, speech requests
    audio/               synthesis, the score and its played grooves, the music kit a
                         model composes with and the player of its notes, mastering,
                         word timing, WAV
    export/              the MP4 and MOV writer, the WebM writer, the ZIP writer, H.264 sample shaping and MP3 frames,
                         export sizes
    util/                colour and JSON helpers
  render/                the locked-down render worker and its host, footage frames,
                         encoder sinks, export
  platform/              the desktop app or a browser: films, files, media (media.js), voices, the
                         relay, settings and keys, the run history, the window
  app/                   the editor: its state, panels, dialogs, the director's
                         conversation and its model picker
src-tauri/src/commands/  films, exports, sound, encoders, media, voices, keys, the relay,
                         the usage log, web search and page reading
scripts/checks/          the check suite: every script runs on npm run check
```

## The walls

- **The worker.** Model-written drawing code runs only in the render worker,
  after `src/render/lockdown.js` has taken away every way to reach the network,
  storage, timers, threads or the clock. The page sends it frames of imported
  footage as pictures; it never reads a file.
- **The content policy** (`src-tauri/tauri.conf.json`) lets the page reach
  model servers on this computer and the app's own media address, and
  nothing on the internet. Cloud services are asked by the desktop side
  (`src-tauri/src/commands/relay.rs`), from a fixed table, with the keys only
  it holds (`src-tauri/src/commands/keys.rs`). `scripts/checks/policy.mjs`
  holds the policy, the table, the catalog and the kept keys together.
- **No paths from the page.** Films are named by id, exports and imports go
  through the system's dialogs, imported files and voice installs are
  remembered by the desktop side, and the relay reaches a fixed table of
  addresses. See [SECURITY.md](SECURITY.md).

## Rendering and export

The render host (`src/render/host.js`) keeps the worker and, for each film,
one hidden video element a clip of footage. For the preview it asks for a
frame as a picture; for an export it asks for RGBA pixels, which move from
the worker without copying. In the desktop app every export is encoded by
the app's own encoders (`src-tauri/src/commands/encode.rs`): H.264 for MP4
and MOV, AV1 for WebM (`av1.rs`), GIF, and MP3 and Vorbis (`vorbis.rs`) for
sound; the next frame is drawn while the last is encoded. The page shapes
the H.264 stream into samples and writes MP4 and MOV itself
(`src/core/export/mp4.js`), and WebM from the AV1 packets and Vorbis packets
(`src/core/export/webm.js`). Sound goes into MP4 and MOV as AAC where the
web view or the system can encode it, otherwise as MP3.

## Checks

`npm run check` runs every script in `scripts/checks/`: the scene format and
its field guard, every composition in every look and frame shape, the film
checks, the director with a scripted model, the brief check, model requests
and replies, settings, the store and editing, sound and file writing, the
worker's walls, the content policy and the bridge to the Rust side, the run
record, templates, file-size budgets, and that nothing ships an emoji, a
secret or another product's name. The Rust side has its own tests
(`cargo test`), and CI runs both on every push.
