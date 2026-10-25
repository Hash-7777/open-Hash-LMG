# Motion rules

The rules Hash LMG lays out, times and checks a film by, each with where it
lives in the code and where it comes from. A source carries a weight:

- **Strong**: peer-reviewed research, or a broadcast or accessibility standard.
- **Fair**: a platform's or vendor's own documentation, or a pattern repeated
  across many independent sources.
- **Lore**: practitioner advice with no study behind it, followed as a habit.

Every rule below is in the code today. The film checks
(`src/core/scene/lint.js`) report each one with a level (error, warn, info)
and, where a rule can repair it, a fix the director applies by itself
(`autofix`). The compiler (`src/core/scene/compile.js`) follows the same
rules when it lays a storyboard out, so a guided film starts out passing them.

## Opening

| Rule | In the code | Source | Weight |
|---|---|---|---|
| Frame one is a picture already forming, never an empty frame. | `empty-open`, fixed by starting the opening line's entrance before the film does; the compiler does it for every film. | Short-video retention is settled in the first one or two seconds; creator briefs ask that frame one be a finished picture. | Fair |
| Something moves in the first moment. | `slow-open`, fixed by starting the first motion at once. | Onset of motion captures attention (Abrams and Christ, 2003). | Strong |

## Reading

| Rule | In the code | Source | Weight |
|---|---|---|---|
| A line holds for 0.8 s plus 2.5 words a second, never under 1.2 s; one or two words for 0.9 s. | `readingTime` in `format.js`; `read-time`, fixed by holding the scene longer; the compiler times every beat by it. | Subtitle and broadcast reading-speed practice. | Strong |
| At most about seven words on screen at once. | `long-text` above sixteen words. | Multimedia learning: short text beside the picture (Mayer). | Strong |
| Text is large enough to read on a phone. | `small-text`: at least 26, or 34 in a vertical frame, on the 1080 scale; fixed by enlarging. | Platform readability guidance. | Fair |
| Text stands out from what is behind it. | `contrast`: 4.5 to 1, or 3 to 1 for large text; fixed by choosing the palette colour with the most contrast. | WCAG 2 contrast minimums. | Strong |

## Place

| Rule | In the code | Source | Weight |
|---|---|---|---|
| Words stay inside the frame. | `off-frame` from the measured boxes; fixed by shrinking and moving the line inside. | | |
| Words stay inside the title-safe area, and in a vertical frame clear of where phone apps draw their own buttons and captions. | `safe-area` with `safeArea()`; fixed the same way. | Safe-zone guidance from vertical video platforms. | Fair |
| Lines do not cover each other. | `overlap` from the measured boxes; fixed by moving one line away. | | |
| Words never cross other words while they move, not only at rest. | `collide-in-motion`, from frames measured a quarter, half and three quarters through each transition and half way through each line's entrance (`motionTimes`); across a scene change fixed by a dip through the background, within a scene by moving one line aside. The compiler makes every fade and zoom a handoff: the new scene's words arrive as the old ones leave. | Research on generated animation: layout faults appear mid-transition that resting frames never show (2026 preprint). | Fair |

## Motion

| Rule | In the code | Source | Weight |
|---|---|---|---|
| Things that land do so on a critically damped spring: fast, then resting, never past the target. | The `settle` ease in `src/core/engine/ease.js`; the Stage style eases everything with it. | Creator briefs for directed motion ask for exactly this curve, 1 - (1 + w t) e^(-w t). | Lore |
| Figures land harder rolling into place than counting up: every digit column spins and stops, left to right, the last as the count ends. | Counters with `roll` (`src/core/engine/odometer.js`); the Stage style rolls its stats. | Product launch films set figures on an odometer. | Lore |
| No bounce: things arrive and settle without overshooting. | `overshoot` on easings that overshoot; fixed by an exponential ease out. | Bounce and springy pop-ins read as cheap in premium motion. | Lore |
| Something new begins every few seconds; reading time counts as time well spent. | `dead-time`, scaled to the words on screen; fixed by a slow camera push. | Onset of motion captures attention and steady motion stops holding it. | Strong (inferred) |
| Four or more things never arrive in the same instant. | `crowded-entrance`; fixed by a short stagger. | Signalling: one cue at a time (Mayer). | Strong |
| Two or three kinds of transition, used consistently. | `transition-mix`; fixed by the style's own transitions; the compiler cycles only those. | Consistency reads as designed. | Lore |
| A transition arrives in about half a second. | `slow-transition` above 1.2 s. | | Lore |
| One element carries the story across a scene change: the same words in two scenes in a row move and resize into place instead of leaving and arriving again. | The `carry` transition (`src/core/engine/carry.js`); the compiler uses it wherever two scenes in a row show the same words. | Creator briefs for directed motion: one object keeps its identity across shots. | Lore |
| A slow push on every scene, at one steady speed, so nothing is ever fully still; an eased camera all but stops at both ends of a scene. | The compiler's scene cameras; a directed film turns through push, pull, drift and rise moves (`cameraFor` in `src/core/scene/direction.js`). | Product launch films keep the camera drifting. | Lore |
| Something moves on every beat: no stretch longer than two beats where the frame does not change, the end card excepted. | `frozen`, measured on frames rendered a beat apart (`beatTimes` and `frameShift` in `src/core/scene/samples.js`); fixed by a slow push. | The measured quality bar of the most directed model-made films: no still stretch longer than about half a second. | Lore |

## Direction

| Rule | In the code | Source | Weight |
|---|---|---|---|
| Every film is designed for its own brief: no two briefs, and no two takes of one brief, share a look, a colour, a tempo or a set of compositions. | `chooseDirection` in `src/core/scene/direction.js`, read from the brief's words and the model's suggested look, turned by a take number. | The briefs behind the most directed model-made films all name their look and ban "anything that looks like a template". | Fair |
| Vary scale and composition; never the same composition twice in a row. | Several compositions per kind of scene in `src/core/scene/layouts.js`, chosen by `layoutFor`. | Creator briefs for directed motion. | Lore |
| The accent colour reads on its field: 3 to 1 for large type. | `chooseDirection` keeps a suggested or brief-named colour only when it does; checked in `scripts/checks/direction.mjs`. | WCAG 2 contrast minimum, large text. | Strong |
| Models that design their own motion are given the moves of the best directed films and a banned list. | `MOTION` and `BANNED` in `src/core/director/prompts.js`, in the plan and code prompts. | Repeated across the most detailed briefs behind model-made films. | Fair |

## Time and sound

| Rule | In the code | Source | Weight |
|---|---|---|---|
| Scenes start on the beat, so cuts land with the music. | The compiler rounds every scene to the beat grid; the score (`src/core/audio/score.js`) lands its drop on the reveal. | A cut that lands with a sound reads as one event (audiovisual synchrony). | Strong |
| Narration is one script over the film: no scene stands still waiting for its line. | `placeNarration` in `src/core/scene/narration-timing.js` starts each line in its own scene after the one before it, lets it run on into the next scene for about a second, and lengthens a scene only by what a line needs beyond that; `voice-overrun` lays the lines out again. The storyboard prompt gives the voice a word budget for the film's length. | Write the narration as one flowing script and cut the picture to it; never freeze a shot to wait for a line (the skill's rejected cuts). | Lore |
| No frame between scenes is empty. | Each scene's first words begin as it arrives; across a fade or a zoom the words leaving lift away in the first part of the change and the new ones arrive in the rest (`src/core/scene/compile.js`), checked in `scripts/checks/timing.mjs`. | No dead air between scenes (the skill's rejected cuts). | Lore |
| A film comes out near the length asked for. | The compiler stretches holds when there is room and leaves out the least important beats when the words, or the narration said end to end, need far more time, keeping the opening, the name and the end; `length` reports what is left over. | One idea a shot. | Lore |
| Loudness near -14 LUFS with true peaks under -1 dBTP. | `master()` in `src/core/audio/master.js`. | Platforms turn louder uploads down to about -14 LUFS (ITU-R BS.1770 measurement). | Fair |

## Editing

| Rule | In the code | Source | Weight |
|---|---|---|---|
| When a scene gets longer or shorter, what ran to its end still does, exits move with it, and entrances keep their time. | `resizeScene` in `src/core/scene/edit.js`, used by the timeline and the inspector. | How motion templates protect their intro and outro when their length changes. | Fair |
| A version for another screen is laid out again for it, never cropped. | `src/app/versions.js`. | Responsive layouts in motion tools; recompose rather than crop. | Fair |

## Sources

- Abrams, R. A. and Christ, S. E. (2003). Motion onset captures attention. *Psychological Science* 14(5).
- Mayer, R. E. *Multimedia Learning* (principles of signalling, segmenting, coherence and redundancy).
- W3C, Web Content Accessibility Guidelines 2, contrast minimum.
- ITU-R BS.1770, algorithms to measure audio programme loudness and true-peak level.
