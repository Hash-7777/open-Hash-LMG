<div align="center">

<picture>
  <source media="(prefers-color-scheme: light)" srcset="docs/assets/hero-light.svg">
  <img src="docs/assets/hero-dark.svg" width="100%" alt="Hash LMG, Hash Local Motion Graphics: motion graphics from a sentence, made with local models or your own keys">
</picture>

<br><br>

### Hash Local Motion Graphics

**Type what the film should say. Get a designed, timed, scored motion-graphics film back.**<br>
Made by the model on your own computer, or by any cloud model on your own key.

<p><img alt="Status: in development" src="https://img.shields.io/badge/status-in%20development-d9b46c?style=flat-square&labelColor=12131c"> <img alt="Licence: GPL v3" src="https://img.shields.io/badge/licence-GPL%20v3-2d333b?style=flat-square&labelColor=12131c"> <img alt="Tauri v2" src="https://img.shields.io/badge/Tauri-v2-2d333b?style=flat-square&logo=tauri&logoColor=c9d1d9&labelColor=12131c"> <img alt="Local first" src="https://img.shields.io/badge/local-first-2d333b?style=flat-square&labelColor=12131c"> <img alt="Ollama, LM Studio, llama.cpp" src="https://img.shields.io/badge/Ollama%20%C2%B7%20LM%20Studio%20%C2%B7%20llama.cpp-2d333b?style=flat-square&labelColor=12131c"> <img alt="Vanilla JavaScript" src="https://img.shields.io/badge/vanilla-JavaScript-2d333b?style=flat-square&logo=javascript&logoColor=c9d1d9&labelColor=12131c"></p>

</div>

<br>

> **Hash LMG is Hash Local Motion Graphics.** The best AI models already make motion graphics by working like a studio: they plan the story, write the animation, render frames, look at the stills and fix what is wrong. Hash LMG turns that way of working into an app, and does the hard parts itself, so even a small model on a laptop can make a film that looks designed.

<br>

## How a film is made

<picture>
  <source media="(prefers-color-scheme: light)" srcset="docs/assets/pipeline-light.svg">
  <img src="docs/assets/pipeline-dark.svg" width="100%" alt="Brief, storyboard, design, check, film">
</picture>

| Step | What happens |
|---|---|
| **01 Brief** | You describe the film in a sentence or two: what it is for, how long, landscape or vertical. |
| **02 Storyboard** | The model writes the words and numbers, beat by beat: a hook, a statement, a stat, a list, a quote, an end card. Then it draws the few things the film is about, from the brief's own subject, as simple line drawings that draw themselves on in the film. |
| **03 Design** | The app directs the film from the brief: a look, an accent colour, a tempo and key for the music, the transitions and camera moves it cuts with, and a composition for every scene, built around its drawing when it has one, so two briefs, or two takes of one brief, never come out alike. Then it times every line to how long it takes to read and starts every scene on the beat of the music. |
| **04 Check** | Key moments are rendered and measured: text off the frame, outside a phone's safe area, too small, too faint, too fast to read, or a scene that sits still too long. What rules can fix, they fix. The film is also held to what the brief asks to see: what must appear, in what order, what counts up, what is on screen at the end. The rest goes back to the model. |
| **05 Film** | An original score fitted to the cuts, composed by the model as code for this film alone, narration if you want it, mastered to the loudness video platforms play at, written to MP4, MOV or GIF at 480p to 4K and 24 to 60 frames a second, by encoders built into the app, the same on macOS, Windows and Linux. A still (PNG) or the sound alone (WAV, MP3) can be exported too. |

<br>

## One app, any model

A three-billion-parameter model cannot lay out a film. It can write a good storyboard. So Hash LMG gives every model the job it can actually do:

| Way of working | For | The model writes | The app does |
|---|---|---|---|
| **Guided** | Small local models, under 10B | The storyboard's words and numbers, and line drawings of what the film is about | All of the layout, timing, motion and sound |
| **Plan** | Mid-size and large models | A full scene plan, starting from the app's own design, a few scenes at a time | Repairs it, checks it, sends back only the scenes that are wrong |
| **Code** | The strongest cloud models | Their own animation code, frame by frame | Runs it in a locked box with no network, no storage and no clock, then checks the stills |

The app suggests the way of working from the model's size, and you can always choose another. A model that can see pictures also reviews a contact sheet of stills, like a creative director, and asks for changes once.

Every answer is kept short enough to finish: a redesign goes a few scenes at a time, so a part that fails costs only that part, and a fix sends only the scenes the checks named. Plans are sent without empty values, every part starts with the same text so services that cache a request's start read it once, and a run's Markdown record lists the tokens each request used, as the service reported them.

<br>

## Seven looks, built in

<picture>
  <source media="(prefers-color-scheme: light)" srcset="docs/assets/styles-light.svg">
  <img src="docs/assets/styles-dark.svg" width="100%" alt="Studio, Paper, Mono, Vivid, Editorial and Tech">
</picture>

By default the look is matched to the brief: a calm brief, a technical one and a luxury one each get a look that suits them, and a model may suggest a mood, an accent colour and a tempo. Each style is a complete design: palette, type, background, and the two or three transitions it cuts with. **Studio** is near-black and quiet. **Paper** is a Swiss grid with a red mark. **Mono** types on and cuts on the beat. **Vivid** changes colour field scene by scene. **Editorial** sets serif headlines and holds long. **Tech** draws contour lines behind precise type. **Stage**, not pictured above, sets medium-weight type rising softly into place on a black stage, with one lit colour and figures that roll in on an odometer.

<br>

## What a film is made of

| Part | What it does |
|---|---|
| **Kinetic type** | Letters, words, typewriter, mask reveals and wipes, with accent words, underlines drawn on and highlighter sweeps |
| **Motion** | Fourteen entrances, plus exits, holds and keyframes, eased the way motion designers ease: fast in, no bounce |
| **Shapes and data** | Rings, lines, arrows and any SVG path drawn on stroke by stroke; counters that count up; bar and line charts that grow |
| **Camera and cuts** | Slow pushes and pans per scene; push, slide, zoom-through, wipe, fade and dip transitions, and a carry that moves one element into the next scene while the rest crossfades |
| **Your own footage** | Video (MP4, MOV, WebM), pictures and sound imported from this computer and linked where they are, never copied: a clip or a picture becomes a scene, trimmed by where it starts and how long it runs, split at the playhead, faded, titled over and set louder or quieter; a song plays as the film's music in place of the score. A film a model makes shows your pictures and clips: the model is told what you gave it (and shown your pictures, when it can see), puts each on the beat it suits, and any it leaves out are placed on suitable beats, whole and framed, with the beat's words beside them |
| **Templates** | Eight films to start from (a launch, an explainer, a year in numbers, an event teaser, a testimonial, a release, a quiet reveal, a calm app), each made whole at once with no model and directed like any other |
| **Formats** | 16:9, 9:16, 1:1 and 4:5, at 24 to 60 frames a second |
| **Sound** | Music the model composes for each film, written as code and played by the app's own instruments (mallet, plucked string, electric piano, synth, bass, pad, bells and drums), after the film's timing is final. Or seven built-in scores, chosen by the brief's mood: three designed ones (deep pulse, soft, cinematic) and four played grooves (bounce, drive, keys, arp), each with its own instruments, drums and a melody written for that film. All in the film's own tempo and key with its chords in one of three orders: a build into the reveal, a boom on the drop, a fade on the end card |
| **Narration** | One line per scene, the music lowered under the voice, captions that light up word by word as they are said |

<br>

## Models and voices

**On your computer:** Ollama, LM Studio and llama.cpp, asked by the desktop app where a server would refuse a web page, so no server switch is needed.<br>
**In the cloud, on your own key:** Anthropic, OpenAI, Google Gemini, OpenRouter, Groq, DeepSeek, Mistral, xAI, Moonshot, Together AI, Fireworks AI and Cerebras.<br>
**Choosing:** one list in the director panel holds every model you can use now, grouped by service and asked of each service when it opens, so it is always that service's current list. Each service remembers the model last chosen on it.<br>
**Voices:** Chatterbox and Kokoro through your own install, pointed at once in Settings, on the processor or the graphics chip; any local speech server; or OpenAI's voices. Lines are spoken when a film with narration is made, or from a scene's inspector.

<br>

## Where it stands

Hash LMG is being built in the open. This is exactly what exists today:

| Works today | Written, not yet run | Next |
|---|---|---|
| Scene format and its repair | Requests to every model service | Windows and Linux runs |
| The engine: type, shapes, charts, transitions | Motion blur | First release for macOS and Windows |
| Film checks and automatic fixes | Films and exports kept by the desktop app | |
| The storyboard compiler, in every style | Sound through the system's own encoder | |
| The director, with a scripted model | Narration mix, word timing and captions | |
| Score and mastering | Processor or graphics-chip choice for Ollama | |
| Narration through a Kokoro install or a local speech server, with word-timed captions | Voices through a Chatterbox install | |
| The editor: preview, timeline, inspector, director, settings | | |
| Pictures: each drawing checked and fitted, and the compositions built around it | Pictures drawn by a real model | |
| Rendering in a background worker; MP4, MOV, GIF and MP3 export by the app's own encoders, in the macOS app | | |
| The macOS app: it builds and opens the editor | | |
| The check suite, `npm run check`, run on every push | | |

"Works today" means exercised in Node with a stand-in canvas and a scripted model, for the editor in a headless browser with a scripted model, and for export in a debug build of the macOS app, with each file read back by the system's own video framework. The built-in encoders build from source on every system; they have been run on macOS only, and nothing has been released.

<br>

## Built to stay yours

Hash LMG is designed so that:

- **There is no account and no server of ours.** Requests go from your computer to the model you chose, and nowhere else.
- **It works offline.** With a local model, every part of a film is made on your computer.
- **Your films are files.** A project is one JSON file; an export is a normal video.
- **It is readable to the last line.** Plain JavaScript and Rust, no bundler, no minified code.

<br>

## Under the hood

```
src/
  index.html       the editor window
  css/             the editor's colours, type and layout, dark and light
  core/            pure modules, no page access: the checks run them in Node
    scene/         format, normaliser, film checks, storyboard, direction, layouts, compiler, examples
    engine/        easing, keyframes, paths, the drawing kit, motion, the renderer
    director/      prompts, the plan-check-revise loop, scene helpers, the code check
    providers/     model services, requests and streams, model sizes, voices
    audio/         synth, score, grooves, the music kit and its player, narration mix, loudness, word timing, WAV
    export/        the MP4 and MOV writer
  render/          the locked-down render worker, its host, footage frames, video export
  platform/        the desktop app or a browser: projects, files, settings and keys
  app/             the editor window: its state, panels and dialogs
src-tauri/         the desktop side: films, exports, sound, encoders, media, voices, keys, the relay, the window's walls
scripts/checks/    the check suite: every script under it runs on npm run check
```

How the parts fit together, the walls around them and how a film is made: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). What has changed: [CHANGELOG.md](CHANGELOG.md).

<br>

## Licence

GNU General Public License, version 3 or later. See [LICENSE](LICENSE).
