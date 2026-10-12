# Hash LMG

Local Motion Graphics. A desktop app, in progress, that makes animated films with
AI models: local models through Ollama, LM Studio or llama.cpp, or cloud models
with your own key. It is being built as a Tauri v2 app with a plain JavaScript
front end and no build step.

## Status

Work in progress. What exists in `src/` today:

- **Scene format and engine** (`src/core/scene`, `src/core/engine`): a JSON scene
  format, a normaliser that repairs what a model writes, a canvas renderer with
  kinetic type, shapes that draw on, counters, charts, transitions and camera
  moves, and film checks for reading time, safe areas, contrast and dead time.
- **Storyboard compiler** (`src/core/scene/compile.js`): a list of beats written by
  even a small local model becomes a laid-out, timed film in one of six styles.
- **Director** (`src/core/director`): the prompts and the plan, check and revise
  loop, in three ways of working matched to the size of the model.
- **Sound** (`src/core/audio`): an original score fitted to the film's beat grid,
  narration mixed over it with the music lowered under the voice, mastered to
  the loudness video platforms play at.
- **Video files** (`src/core/export`, `src/render`): an MP4 and MOV writer, a render
  worker, and export through the system's video encoder.

Not built yet: the editor window, the native side, the check suite and the
connection to voice engines. Nothing here has been run as an app.

## Licence

GNU General Public License, version 3 or later. See `LICENSE`.
