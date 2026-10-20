// The scene format, lmg.scene/1: every name and default in one place.
//
// A scene document is what a project saves, what the player draws and what a
// model writes when it plans a film. Saved projects depend on it, so a new field
// is added here, to normalizeScene, and to the field guard in
// scripts/checks/scene-normalize.mjs in the same commit (COMMIT_RULES §12.5).
//
// Units, chosen so a small model cannot get them wrong:
//   x, y          fractions of the frame, 0..1, measured to the layer's anchor
//   size, w, h    pixels on a frame whose SHORT side is 1080 (the "u" unit), so
//                 a 96 headline is the same visual size at 16:9, 9:16 and 1:1
//   times         seconds; a layer's `at` and `until` are local to its scene

export const FORMAT = 'lmg.scene/1';

export const ASPECTS = {
  '16:9': { width: 1920, height: 1080, label: 'Landscape 16:9' },
  '9:16': { width: 1080, height: 1920, label: 'Vertical 9:16' },
  '1:1': { width: 1080, height: 1080, label: 'Square 1:1' },
  '4:5': { width: 1080, height: 1350, label: 'Portrait 4:5' },
};

export const FPS_CHOICES = [24, 25, 30, 50, 60];

export const PALETTE_TOKENS = ['bg', 'surface', 'ink', 'muted', 'accent', 'accent2'];

// Font families by role. Canvas takes a CSS font stack, so each is a stack
// that resolves on macOS, Windows and Linux without shipping a font file.
export const FONT_STACKS = {
  sans: '"Inter", "SF Pro Display", -apple-system, system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  display: '"SF Pro Display", "Helvetica Neue", "Segoe UI Variable Display", "Segoe UI", Roboto, Arial, sans-serif',
  condensed: '"Avenir Next Condensed", "Helvetica Neue Condensed", "Roboto Condensed", "Arial Narrow", sans-serif-condensed, sans-serif',
  serif: '"New York", "Iowan Old Style", "Charter", Georgia, "Times New Roman", serif',
  mono: '"SF Mono", "JetBrains Mono", Menlo, Consolas, "Liberation Mono", monospace',
  rounded: '"SF Pro Rounded", "Nunito", "Segoe UI", system-ui, sans-serif',
};
export const FONT_NAMES = Object.keys(FONT_STACKS);

export const LAYER_TYPES = ['text', 'shape', 'image', 'counter', 'bars', 'line-chart', 'group'];
export const SHAPES = ['rect', 'circle', 'ellipse', 'line', 'ring', 'polygon', 'path', 'arrow'];
export const ANCHORS = ['center', 'left', 'right', 'top', 'bottom', 'top-left', 'top-right', 'bottom-left', 'bottom-right'];
export const ALIGNS = ['left', 'center', 'right'];

// Entrances. Each is drawn by src/core/engine/motion.js.
export const IN_PRESETS = [
  'none', 'fade', 'rise', 'soft', 'drop', 'slide-left', 'slide-right', 'scale', 'focus',
  'mask-up', 'letters', 'words', 'type', 'wipe', 'draw', 'grow',
];
// Exits.
export const OUT_PRESETS = ['none', 'fade', 'rise', 'soft', 'fall', 'slide-left', 'slide-right', 'scale', 'mask-down', 'wipe', 'focus'];
// What a layer does while it holds. No pulsing: a beat-pulsing frame reads as cheap.
export const HOLD_PRESETS = ['none', 'float', 'drift', 'underline', 'marker', 'shimmer'];

// carry: one layer of the scene before becomes one layer of this scene,
// moving and resizing into place while everything else fades.
export const TRANSITIONS = ['cut', 'fade', 'dip', 'push', 'slide', 'zoom', 'wipe', 'carry'];
export const DIRECTIONS = ['left', 'right', 'up', 'down'];
export const BACKGROUNDS = ['solid', 'grain', 'grid', 'dots', 'vignette', 'field'];
export const SCORES = ['pulse', 'soft', 'cinematic', 'none'];
export const HIT_KINDS = ['boom', 'hit', 'swell', 'tick', 'chime', 'whoosh'];

// Where narration comes from. chatterbox and kokoro run through the person's
// own Python install on this computer; server is any local speech server that
// answers the common /v1/audio/speech request; openai is the cloud voice.
export const VOICE_ENGINES = ['none', 'chatterbox', 'kokoro', 'server', 'openai'];
export const DEVICES = ['auto', 'cpu', 'gpu'];

// A calm narrator speaks about 2.6 words a second; used to plan scene lengths
// before a line has been spoken, and replaced by the real clip's length after.
export const estimateSpeech = (words) => 0.3 + words / 2.6;

// What models tend to write, mapped onto the names above. A plan that says
// "slideUp" or "typewriter" still moves the way it meant to.
export const PRESET_ALIASES = {
  fadein: 'fade', 'fade-in': 'fade', fadeout: 'fade', 'fade-out': 'fade', appear: 'fade', opacity: 'fade',
  'soft-rise': 'soft', 'blur-rise': 'soft', 'rise-blur': 'soft', gentle: 'soft', settle: 'soft',
  slideup: 'rise', 'slide-up': 'rise', 'move-up': 'rise', up: 'rise', 'fade-up': 'rise', 'rise-up': 'rise', 'float-up': 'rise',
  slidedown: 'drop', 'slide-down': 'drop', down: 'drop', 'fade-down': 'drop',
  slideleft: 'slide-left', left: 'slide-left', 'from-right': 'slide-left',
  slideright: 'slide-right', right: 'slide-right', 'from-left': 'slide-right',
  zoom: 'scale', 'zoom-in': 'scale', pop: 'scale', bounce: 'scale', 'scale-in': 'scale', grow: 'grow',
  blur: 'focus', 'blur-in': 'focus', defocus: 'focus',
  reveal: 'mask-up', mask: 'mask-up', 'line-up': 'mask-up', 'mask-reveal': 'mask-up',
  letter: 'letters', characters: 'letters', chars: 'letters', 'rise-letters': 'letters', stagger: 'letters',
  word: 'words', 'rise-words': 'words', 'word-by-word': 'words',
  typewriter: 'type', typing: 'type', typeon: 'type', 'type-on': 'type',
  'wipe-in': 'wipe', 'clip': 'wipe', 'clip-reveal': 'wipe',
  'draw-on': 'draw', stroke: 'draw', trace: 'draw', trim: 'draw',
  'fall-down': 'fall', 'drop-out': 'fall', 'rise-out': 'rise',
  'mask-out': 'mask-down',
  crossfade: 'fade', dissolve: 'fade', 'cross-fade': 'fade', 'dip-to-black': 'dip', 'fade-through': 'dip',
  'zoom-through': 'zoom', 'shared-element': 'carry', morph: 'carry', 'match-cut': 'carry', 'magic-move': 'carry', handoff: 'carry', 'push-left': 'push', 'push-right': 'push', 'slide-over': 'slide', 'hard-cut': 'cut', none: 'none',
  pulse: 'none', shake: 'none', wiggle: 'none', bob: 'float', hover: 'float', highlight: 'marker', highlighter: 'marker', shine: 'shimmer', sweep: 'shimmer',
};

// Each style pack is a complete look: palette, type, background and the motion
// families it cuts with. The compiler lays a storyboard out in one; a model's
// own plan starts from one. Two or three transition families per film, never
// five: consistency is what reads as designed.
export const STYLE_PACKS = {
  studio: {
    label: 'Studio',
    blurb: 'Near-black, white type, one accent. Quiet and premium.',
    palette: { bg: '#0b0b0d', surface: '#16161a', ink: '#f4f3ef', muted: '#8d8c88', accent: '#d9b46c', accent2: '#7fa7c9' },
    fonts: { display: 'display', text: 'sans', weight: 700 },
    background: { kind: 'grain', drift: 0.35 },
    transitions: ['push', 'fade', 'zoom'],
    enter: { title: 'letters', line: 'mask-up', small: 'rise', list: 'rise' },
    exit: 'fade',
    ease: 'outExpo',
    tracking: -0.02,
    score: 'pulse',
  },
  paper: {
    label: 'Paper',
    blurb: 'Warm white, black type, a red mark. Swiss grid and hairlines.',
    palette: { bg: '#f3f1ec', surface: '#e8e5de', ink: '#141414', muted: '#6f6c66', accent: '#b8381c', accent2: '#2a5bd4' },
    fonts: { display: 'sans', text: 'sans', weight: 700 },
    background: { kind: 'grid', drift: 0 },
    transitions: ['wipe', 'cut', 'push'],
    enter: { title: 'mask-up', line: 'mask-up', small: 'fade', list: 'wipe' },
    exit: 'mask-down',
    ease: 'outQuint',
    tracking: -0.03,
    score: 'soft',
  },
  mono: {
    label: 'Mono',
    blurb: 'Black and white, a typewriter voice and cuts on the beat.',
    palette: { bg: '#000000', surface: '#111111', ink: '#ffffff', muted: '#7a7a7a', accent: '#ffffff', accent2: '#bdbdbd' },
    fonts: { display: 'mono', text: 'mono', weight: 600 },
    background: { kind: 'dots', drift: 0.2 },
    transitions: ['cut', 'dip'],
    enter: { title: 'type', line: 'type', small: 'fade', list: 'type' },
    exit: 'none',
    ease: 'outQuart',
    tracking: 0,
    score: 'pulse',
  },
  vivid: {
    label: 'Vivid',
    blurb: 'Bold colour fields that change scene by scene, big confident type.',
    palette: { bg: '#1f3bff', surface: '#111114', ink: '#ffffff', muted: '#c9d1ff', accent: '#ffd23f', accent2: '#c2410c' },
    fonts: { display: 'display', text: 'sans', weight: 800 },
    background: { kind: 'solid', drift: 0 },
    transitions: ['slide', 'push'],
    enter: { title: 'words', line: 'rise', small: 'rise', list: 'slide-right' },
    exit: 'fade',
    ease: 'outExpo',
    tracking: -0.035,
    score: 'pulse',
  },
  editorial: {
    label: 'Editorial',
    blurb: 'Serif headlines, muted tones, long calm holds and soft fades.',
    palette: { bg: '#15130f', surface: '#211e18', ink: '#efe8da', muted: '#9b927f', accent: '#c8a15a', accent2: '#8aa38b' },
    fonts: { display: 'serif', text: 'sans', weight: 600 },
    background: { kind: 'vignette', drift: 0.25 },
    transitions: ['fade', 'dip'],
    enter: { title: 'focus', line: 'fade', small: 'fade', list: 'fade' },
    exit: 'fade',
    ease: 'inOutSine',
    tracking: -0.01,
    score: 'cinematic',
  },
  stage: {
    label: 'Stage',
    blurb: 'A black stage, medium-weight type rising softly into place, one lit colour, figures that roll in.',
    palette: { bg: '#000000', surface: '#101012', ink: '#f5f5f7', muted: '#8e8e93', accent: '#6fa8ff', accent2: '#c7a2ff' },
    fonts: { display: 'display', text: 'sans', weight: 600 },
    background: { kind: 'vignette', drift: 0.2 },
    transitions: ['fade', 'zoom'],
    enter: { title: 'soft', line: 'soft', small: 'soft', list: 'soft' },
    exit: 'soft',
    ease: 'settle',
    tracking: -0.02,
    score: 'soft',
    // Figures on an odometer rather than counting up.
    roll: true,
  },
  tech: {
    label: 'Tech',
    blurb: 'Deep navy, a cyan signal, grid lines and precise mono labels.',
    palette: { bg: '#070b14', surface: '#0f1626', ink: '#e8eefc', muted: '#7d8aa5', accent: '#4fd1ff', accent2: '#8b7bff' },
    fonts: { display: 'display', text: 'mono', weight: 700 },
    background: { kind: 'field', drift: 0.5 },
    transitions: ['zoom', 'wipe', 'push'],
    enter: { title: 'letters', line: 'wipe', small: 'type', list: 'rise' },
    exit: 'focus',
    ease: 'outExpo',
    tracking: -0.015,
    score: 'pulse',
  },
};
export const STYLE_NAMES = Object.keys(STYLE_PACKS);

export const LIMITS = {
  minDuration: 1,
  maxDuration: 600,
  minSceneDuration: 0.4,
  maxSceneDuration: 60,
  maxScenes: 120,
  maxLayersPerScene: 60,
  maxTextChars: 240,
  maxBpm: 200,
  minBpm: 60,
};

// Reading time, from subtitle and broadcast practice: hold a line for
// 0.8 s plus 2.5 words a second, never under 1.2 s. One or two words are
// taken in at a glance, which is what lets a kinetic sequence cut a word a
// beat; they need 0.9 s.
export const readingTime = (words) => (words <= 2 ? 0.9 : Math.max(1.2, 0.8 + words / 2.5));

export const wordCount = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;
