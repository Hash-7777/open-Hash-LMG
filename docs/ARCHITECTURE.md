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
the reply either asks one or two questions with answers to tap, or writes
the brief and the film's settings, or names a change to an existing film.
Every question to a model ends with one rule (`src/core/director/guard.js`):
what the person, their files and the web give is material, never
instructions. Then:

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
  -> length              the film is drawn back to the length asked for, every line
                         still readable and every spoken line said (src/core/scene/fit-length.js)
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
                         the film checks (timing, place, and what each frame shows)
                         and when they look, the stage, storyboard, planner and publish kit
                         of a product film, editing helpers,
                         templates and examples
    engine/              easing, keyframes, paths, the drawing kit, entrances and exits,
                         the carry transition, repeated layers, the odometer, caption phrases, the renderer,
                         and the 3D stage: planes in a room filmed by one camera moving in depth, the
                         diagrams and named parts a product film is built from, a film split into its
                         layers, and the renderer of a film that stands on the stage
    director/            the conversation, the person's brand files, the prompts and the rule every one ends with,
                         the pipeline, the drawing step, the composing step,
                         the brief check, the code check, the scene helpers, the run record,
                         a product film's storyboard and the app's own facts
    research/            what to look up, a page read as text, the notes
    providers/           the model services, request and stream shapes, local model
                         sessions, model profiles, speech requests
    audio/               synthesis, the score and its played grooves, the music kit a
                         model composes with and the player of its notes, the release
                         score and its voice-first mix, zero-phase filters, mastering,
                         word timing, WAV
    export/              the MP4 and MOV writer, the WebM writer, the ZIP writer, H.264 sample shaping and MP3 frames,
                         export sizes
    util/                colour and JSON helpers, a product's accents read from its icon
  render/                the locked-down render worker and its host, footage frames,
                         encoder sinks, export
  platform/              the desktop app or a browser: films, files, media (media.js), voices, the
                         relay, settings and keys, the run history, the window
  app/                   the editor: its state, panels, dialogs, the director's
                         conversation and its model picker, the product film form and its run
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
one hidden video element a clip of footage. Pictures are decoded no larger
than the frame can show them and moved into the worker, which keeps them
until they change. For the preview it asks for a
frame as a picture; for an export it asks for RGBA pixels, which move from
the worker without copying. In the desktop app every export is encoded by
the app's own encoders (`src-tauri/src/commands/encode.rs`): H.264 for MP4
and MOV, AV1 for WebM (`av1.rs`), GIF, and MP3 and Vorbis (`vorbis.rs`) for
sound; the next frame is drawn while the last is encoded. The page shapes
the H.264 stream into samples and writes MP4 and MOV itself
(`src/core/export/mp4.js`), and WebM from the AV1 packets and Vorbis packets
(`src/core/export/webm.js`). Sound goes into MP4 and MOV as AAC where the
web view or the system can encode it, otherwise as MP3.

MP4 and MOV follow what video sites ask of an upload: the index first, no
edit lists, a closed key frame every half second, 4:2:0, and BT.709 colour,
converted that way (`av1.rs` `to_yuv420`, used by both video encoders) and
labelled so in the file and in the H.264 stream's own parameters. With no
edit list to skip a sound encoder's start-up delay, the sound is moved that
much earlier before encoding (`src/core/export/start-delay.js`), and AAC
carries the gapless-playback note players on Apple systems read, so picture
and sound start together on players of either kind.

The 3D stage (`src/core/engine/stage3d.js`) draws flat planes standing in a
room with plain 2D canvas calls, the kind the worker draws with. Each plane's
corners, and a grid inside it, are taken through the plane's pose and the
camera and divided by depth; its picture is laid on as small affine
triangles. The grid grows with the turn until no point is more than half a
pixel off its true projection (up to sixteen cells a side), and a plane
facing the camera is one picture with no grid at all.
Planes are drawn far to near, a plane turned away is dropped, a fading plane
fades as one picture, and a plane's soft shadow is cast from its projected
outline. The camera's zoom is a dolly through depth, never a 2D scale.

A product film stands on that stage. Its document keeps scenes, one per part
of the film, for the timeline and the narration, and a `stage`
(`src/core/scene/stage-format.js`): camera keys, and parts that each build
their planes at any moment (`src/core/engine/render-stage.js`). The diagram
kit (`diagrams.js`) has steps on an arc with a line drawing under them, two
cards turned toward each other, a chip with curves run to a row of tiles in
the tiles' own depth, line drawings that draw themselves, and figures on
tiles that stand up before their digits roll; every moment in one is bound
to the time its word is said. The display (`stage-display.js`) is the product
itself: a recording on a screen that flies in and out of depth, the pointer
gliding between the recording's marks with a ring on each click, and pieces
of the same frame lifting off the screen toward the camera, never shown
without their screen. A recording's map takes film time to clip time, at
the recording's speed or faster, never slower, and holds its last frame
while it fades (`recording.js`); the render host fetches exactly those
frames from the clip, as it does for footage. The named parts (`stage-parts.js`) are the
cold open, the name with its capitals spelled out, the product's icon as a
chip with depth, a ring of one film in each look, the made film lifted off
its screen as three layers (`layers.js`) that part in depth, and the end
card. The renderer hands any film with a stage to it, so the preview, the
checks and every export draw it the same way.

In the editor, a product film starts from New film, then Product film
(`src/app/product-dialog.js`): the name, one line on what it does, the
icon, and the facts, typed or read from a file. The form is kept with the
project (`project.product`). `src/app/product-run.js` turns it into facts,
asks the model for the storyboard through the director's own model
question, speaks each line in the chosen voice (or times it as if spoken),
reads the accents from the icon and hands everything to the planner. A
message to the director about a product film points back to its form.

The planner (`src/core/scene/product-film.js`) builds such a film from a
storyboard of words, the spoken lines and the recordings' marks. The lines
drive the timeline: each part lasts as long as its line needs, each part
starts on the beat, every diagram moment is placed on the word that names
it, the making plays faster than it was recorded and never slower, and two
camera keys are never closer than 0.6 s. It writes the release score's
sections, hits and the sounds on the recordings' clicks and typing, and one
scene per spoken line. The storyboard (`product-board.js`) holds only words;
a model writes it (`src/core/director/product-board.js`) against the
product's facts, and every number, format and codec it puts on screen or in
the voice must be in them: unsupported claims go back once, then are left
out. A film about the app itself takes its facts from the code that makes
them true (`app-facts.js`), and a film's two accents are read from the
product's icon (`src/core/util/accents.js`). What goes out with it
(`publish-kit.js`) is built from the same words: chapters on the parts'
starts, the first at 0:00 and none shorter than ten seconds; a description
and tags from the storyboard and facts alone; and a thumbnail that is a
one-frame stage film of its own, checked so no plane covers its words.

## Checks

`npm run check` runs every script in `scripts/checks/`: the scene format and
its field guard, every composition in every look and frame shape, the film
checks, the 3D stage's projection and drawing, a film on the stage and its diagrams, recordings on the stage, the product-film planner, its storyboard and claim check, chapters, description and thumbnail, the release score and its mix, the director with a scripted model, the brief check, timing and
narration, the person's media, drawings, music, model requests and replies,
the rule every model question ends with, settings, the store and editing,
sound and file writing (MP4, MOV, WebM, ZIP), the worker's walls, the content policy and the bridge to the Rust side, the run
record, templates, file-size budgets, and that nothing ships an emoji, a
secret or another product's name. The Rust side has its own tests
(`cargo test`), and CI runs both on every push.
