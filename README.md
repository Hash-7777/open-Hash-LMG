<div align="center">

<picture>
  <source media="(prefers-color-scheme: light)" srcset="docs/assets/hero-light.svg">
  <img src="docs/assets/hero-dark.svg" width="100%" alt="Hash LMG, Hash Local Motion Graphics: motion graphics from a sentence, made with local models or your own keys">
</picture>

<br><br>

## One sentence in. A finished motion-graphics film out.

**Storyboard, kinetic type, drawings, an original score, narration and the export.**<br>
**Made by the model on your laptop, or any cloud model on your own key.**

<p><img alt="Status: in development" src="https://img.shields.io/badge/status-in%20development-d9b46c?style=flat-square&labelColor=12131c"> <img alt="Licence: GPL v3" src="https://img.shields.io/badge/licence-GPL%20v3-2d333b?style=flat-square&labelColor=12131c"> <img alt="Tauri v2" src="https://img.shields.io/badge/Tauri-v2-2d333b?style=flat-square&logo=tauri&logoColor=c9d1d9&labelColor=12131c"> <img alt="Local first" src="https://img.shields.io/badge/local-first-2d333b?style=flat-square&labelColor=12131c"> <img alt="Ollama, LM Studio, llama.cpp" src="https://img.shields.io/badge/Ollama%20%C2%B7%20LM%20Studio%20%C2%B7%20llama.cpp-2d333b?style=flat-square&labelColor=12131c"> <img alt="MP4, MOV, WebM, GIF" src="https://img.shields.io/badge/MP4%20%C2%B7%20MOV%20%C2%B7%20WebM%20%C2%B7%20GIF-2d333b?style=flat-square&labelColor=12131c"></p>

[**Run it**](#run-it-in-four-steps) &nbsp;·&nbsp; [How it works](#how-a-film-is-made) &nbsp;·&nbsp; [Looks](#seven-looks-built-in) &nbsp;·&nbsp; [Where it stands](#where-it-stands) &nbsp;·&nbsp; [Architecture](docs/ARCHITECTURE.md)

</div>

<br>

> Type *"a 30-second launch film for my desk lamp, calm, with a voice"*.<br>
> Hash LMG writes the storyboard, draws the lamp, lays out every frame, composes music for that one film, speaks the lines, checks its own stills and has it ready to export as an MP4.<br>
> **It works with a three-billion-parameter model running on your laptop.**

<br>

## Why it is different

<table>
<tr>
<td width="50%" valign="top">

**Small models make real films.**<br>
A small model cannot lay out a film, but it can write a good storyboard. So that is all it is asked for. Layout, timing, motion and sound are done by the app.

</td>
<td width="50%" valign="top">

**No two films look alike.**<br>
The look, the accent colour, the tempo and key of the music, the transitions and every composition are directed from the brief. Make the same brief again and it comes out as a new film.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**It checks its own work.**<br>
Frames are rendered and measured: words off the frame, too small, too faint, too fast to read, words crossing words mid-move, a scene that sits still. What rules can fix, they fix. The film is held to what the brief asked to see.

</td>
<td width="50%" valign="top">

**Nothing leaves your machine.**<br>
No account and no server of ours. With a local model every part of a film is made on your computer. A cloud model is asked only when you choose one, on your own key, kept by the desktop side.

</td>
</tr>
</table>

<br>

## Run it in four steps

There is no release yet. From this repository:

```bash
git clone https://github.com/Hash-7777/open-Hash-LMG.git
cd open-Hash-LMG
npm install
npm run tauri dev
```

You need [Node.js](https://nodejs.org) 20 or later and [Rust](https://rustup.rs) 1.87 or later, plus:

- **macOS:** the Xcode Command Line Tools (`xcode-select --install`).
- **Linux:** the web view's libraries, for example on Debian or Ubuntu: `sudo apt install build-essential pkg-config libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev libssl-dev`.
- **Windows:** the C++ build tools for Visual Studio and the WebView2 runtime (part of Windows 11).

For a model on your computer, install [Ollama](https://ollama.com) and pull any model; Settings walks you through the rest. For a cloud model, add your key in Settings, under Cloud keys. `npm run tauri build` makes an installer under `src-tauri/target/release/bundle/`, and `npm run check` runs every check in under a minute, with Node alone.

<br>

## How a film is made

<picture>
  <source media="(prefers-color-scheme: light)" srcset="docs/assets/pipeline-light.svg">
  <img src="docs/assets/pipeline-dark.svg" width="100%" alt="Brief, storyboard, design, check, film">
</picture>

| | Step | What happens |
|---|---|---|
| **01** | **Brief** | You tell the director what the film is for, in your own words. It decides what it can, asks at most two questions, and waits for anything you say you will send. |
| **02** | **Storyboard** | The model writes the words and numbers, beat by beat, and draws the few things the film is about as line drawings that draw themselves on. |
| **03** | **Design** | The app directs the film from the brief and lays out every scene, times each line to how long it takes to read, and starts every scene on the beat. |
| **04** | **Check** | Key moments are rendered and measured, repaired by rule, and held to what the brief asked to see. The rest goes back to the model, once. |
| **05** | **Film** | Music composed for this film, narration laid over it as one script, mastered to platform loudness and written to MP4, MOV, WebM or GIF, 480p to 4K. |

<br>

## One app, any model

| Way of working | For | The model writes | The app does |
|---|---|---|---|
| **Guided** | Small local models, under 10B | The storyboard's words and numbers, and simple drawings | All of the layout, timing, motion and sound |
| **Plan** | Mid-size and large models | A full scene plan, a few scenes at a time | Repairs it, checks it, sends back only what is wrong |
| **Code** | The strongest cloud models | Their own animation code, frame by frame | Runs it in a locked box with no network, no storage and no clock |

The app suggests the way of working from the model's size; you can always choose another. A model that can see also reviews a contact sheet of stills, like a creative director, and asks for changes once. Every answer is kept short enough to finish, and a run's Markdown record lists each request and the tokens it used.

<br>

## Seven looks, built in

<picture>
  <source media="(prefers-color-scheme: light)" srcset="docs/assets/styles-light.svg">
  <img src="docs/assets/styles-dark.svg" width="100%" alt="Studio, Paper, Mono, Vivid, Editorial, Stage and Tech">
</picture>

**Studio** is near-black and quiet. **Paper** is a Swiss grid with a red mark. **Mono** types on and cuts on the beat. **Vivid** changes colour field scene by scene. **Editorial** sets serif headlines and holds long. **Stage** lifts type softly onto a black stage, with figures that roll in. **Tech** draws contour lines behind precise type. By default the look is matched to the brief.

<br>

## What a film is made of

| Part | What it does |
|---|---|
| **Kinetic type** | Letters, words, typewriter, mask reveals and wipes; accent words, underlines drawn on, highlighter sweeps |
| **Motion** | Sixteen entrances, among them a panel that unfolds from its top edge, plus exits, holds and keyframes, eased the way motion designers ease: fast in, no bounce |
| **Camera and cuts** | Slow pushes and pans; push, slide, zoom-through, wipe, fade and dip; a carry that moves one element, the same words or the same picture, into the next scene |
| **Shapes and data** | Rings, lines, arrows and paths drawn on stroke by stroke; counters that count up; bar and line charts that grow |
| **Your media** | Your pictures, clips and songs, linked where they are and never copied. A model's film puts them on the beats they suit, with a closer second look on the next one |
| **Your brand** | Text files read as your names, facts and voice; hex colours in them become the film's colour; a picture named like a logo goes where the brand shows |
| **Sound** | Music the model composes for each film as code, played by the app's own instruments, or one of seven built-in scores in the film's own tempo and key |
| **Narration** | One script laid over the film in the voice you choose, the music lowered under it; captions that light up word by word when the brief asks for them |
| **Templates** | Eight films to start from, made whole at once with no model |
| **Formats** | 16:9, 9:16, 1:1 and 4:5, at 24 to 60 frames a second |

<br>

## Models and voices

**On your computer:** Ollama, LM Studio and llama.cpp, asked by the desktop app, so no server switch is needed.<br>
**In the cloud, on your own key:** Anthropic, OpenAI, Google Gemini, OpenRouter, Groq, DeepSeek, Mistral, xAI, Moonshot, Together AI, Fireworks AI and Cerebras.<br>
**Looking things up:** the model may ask to search the web or read a page named in the brief; you see every search and page and say yes first.<br>
**Voices:** Chatterbox and Kokoro through your own install, any local speech server, or OpenAI's voices.

<br>

## Where it stands

Hash LMG is being built in the open. This is exactly what exists today:

| Works today | Written, not yet run | Next |
|---|---|---|
| Films made from start to finish in the macOS app, with a local model through Ollama and with a cloud model (DeepSeek) | Requests to the other cloud services | Windows and Linux runs |
| The director, end to end, with a scripted model in the checks | Motion blur | A signed first release |
| Scene format and its repair; the engine: type, shapes, charts, transitions | Voices through a Chatterbox install | |
| The storyboard compiler in every style, film checks and automatic fixes | Processor or graphics-chip choice for Ollama | |
| The editor: preview, timeline, inspector, the director's conversation, settings | Pictures drawn by a real model inside the app (the drawing prompt was tried on small local models outside it) | |
| Score and mastering; narration through a Kokoro install or a local speech server, with word-timed captions | WebM export from the app (its encoders and its file were checked outside it: the file plays in a browser) | |
| Rendering in a background worker; MP4, MOV, GIF and MP3 export by the app's own encoders, in the macOS app | | |
| The check suite, `npm run check`, and the Rust build and tests, on every push | | |

"Works today" means run: in the macOS app with real models, in Node with a stand-in canvas and a scripted model, for the editor in a headless browser, and for export in a build of the macOS app with each file read back by the system's own video framework. The app and its built-in encoders build from source on every system and are compiled on Linux on every push; they have been run on macOS only, and nothing has been released.

<br>

## Built to stay yours

- **No account, no server of ours.** Requests go from your computer to the model you chose, and nowhere else.
- **Works offline.** With a local model, every part of a film is made on your computer.
- **Your films are files.** A project is one JSON file; an export is a normal video.
- **Readable to the last line.** Plain JavaScript and Rust, no bundler, no minified code.
- **Walled in.** Code a model writes runs with no network, storage or clock; every question to a model treats your files and the web as material, never instructions. See [docs/SECURITY.md](docs/SECURITY.md).

<br>

## Under the hood

```
src/
  index.html       the editor window
  css/             the editor's colours, type and layout, dark and light
  core/            pure modules, no page access: the checks run them in Node
    scene/         format, normaliser, film checks, storyboard, direction, layouts, compiler, examples
    engine/        easing, keyframes, paths, the drawing kit, motion, the renderer
    director/      the conversation, prompts and the rule every one ends with, the plan-check-revise
                   loop, drawings, music, the brief check, the code check, the run record
    research/      what to look up, pages read as text, the notes
    providers/     model services, requests and streams, model sizes, voices
    audio/         synth, score, grooves, the music kit and its player, narration mix, loudness, word timing, WAV
    export/        the MP4, MOV, WebM and ZIP writers
  render/          the locked-down render worker, its host, footage frames, video export
  platform/        the desktop app or a browser: projects, files, settings and keys
  app/             the editor window: its state, panels and dialogs
src-tauri/         the desktop side: films, exports, sound, encoders, media, voices, keys, the relay, web reading, the window's walls
scripts/checks/    the check suite: every script under it runs on npm run check
```

How the parts fit together: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). The walls around keys, files, the network and code a model writes: [docs/SECURITY.md](docs/SECURITY.md). The motion rules the films follow, and where each comes from: [docs/MOTION-RULES.md](docs/MOTION-RULES.md). What has changed: [CHANGELOG.md](CHANGELOG.md).

<br>

## Contributing

Issues and pull requests are welcome. Before a pull request, run `npm run check`, and `cargo test` in `src-tauri/` when the Rust side changed; [CONTRIBUTING.md](CONTRIBUTING.md) has the few rules the code keeps.

## Licence

GNU General Public License, version 3 or later. See [LICENSE](LICENSE).
