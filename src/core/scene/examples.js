// Example scenes. One is shown to models as the shape of a good plan, one opens
// a new project so the player has something to play, and the checks render all
// of them. Every word and number in them is invented.

export const EXAMPLE_LAUNCH = {
  format: 'lmg.scene/1',
  title: 'Northwind launch',
  aspect: '16:9',
  fps: 60,
  bpm: 120,
  style: 'studio',
  sound: { score: 'pulse', hits: [{ t: 4.0, kind: 'boom' }] },
  scenes: [
    {
      id: 'hook',
      duration: 2.5,
      camera: { zoom: [1, 1.04] },
      layers: [
        { type: 'text', text: 'Plans change.', x: 0.5, y: 0.5, size: 120, weight: 700, in: { preset: 'letters', duration: 0.7, stagger: 0.03 } },
      ],
    },
    {
      id: 'turn',
      duration: 2.5,
      transition: { kind: 'push', direction: 'left', duration: 0.5 },
      layers: [
        { type: 'text', text: 'Your calendar should too.', x: 0.5, y: 0.5, size: 92, weight: 700, highlight: ['too.'], hold: 'underline', in: { preset: 'mask-up', duration: 0.7 } },
      ],
    },
    {
      id: 'reveal',
      duration: 3.5,
      transition: { kind: 'zoom', duration: 0.5 },
      camera: { zoom: [1.02, 1] },
      layers: [
        { type: 'shape', shape: 'ring', x: 0.5, y: 0.42, w: 180, strokeWidth: 10, color: 'accent', in: { preset: 'draw', duration: 1.0, ease: 'inOutCubic' } },
        { type: 'text', text: 'Northwind', x: 0.5, y: 0.66, size: 132, weight: 800, at: 0.3, in: { preset: 'focus', duration: 0.8 }, hold: 'shimmer' },
        { type: 'text', text: 'The calendar that plans with you', x: 0.5, y: 0.78, size: 40, weight: 500, color: 'muted', at: 0.8, in: { preset: 'rise', duration: 0.7 } },
      ],
    },
    {
      id: 'proof',
      duration: 3.5,
      transition: { kind: 'push', direction: 'up', duration: 0.5 },
      layers: [
        { type: 'counter', from: 0, to: 12, suffix: ' hours', x: 0.5, y: 0.42, size: 170, weight: 800, color: 'accent', in: { preset: 'rise', duration: 0.6 }, count: 1.4 },
        { type: 'text', text: 'saved every week, on average, in our invented study', x: 0.5, y: 0.62, size: 40, weight: 500, color: 'muted', at: 0.5, in: { preset: 'rise' } },
      ],
    },
    {
      id: 'list',
      duration: 4,
      transition: { kind: 'fade', duration: 0.4 },
      layers: [
        { type: 'text', text: 'Moves meetings for you', x: 0.32, y: 0.36, anchor: 'left', align: 'left', size: 56, weight: 650, at: 0.0, in: 'rise' },
        { type: 'text', text: 'Guards your focus time', x: 0.32, y: 0.5, anchor: 'left', align: 'left', size: 56, weight: 650, at: 0.25, in: 'rise' },
        { type: 'text', text: 'Works with every calendar', x: 0.32, y: 0.64, anchor: 'left', align: 'left', size: 56, weight: 650, at: 0.5, in: 'rise' },
        { type: 'shape', shape: 'line', x: 0.29, y: 0.5, w: 0, h: 300, strokeWidth: 4, color: 'accent', in: { preset: 'draw', duration: 1.2 } },
      ],
    },
    {
      id: 'end',
      duration: 3.5,
      transition: { kind: 'zoom', duration: 0.5 },
      layers: [
        { type: 'text', text: 'Northwind', x: 0.5, y: 0.45, size: 120, weight: 800, in: { preset: 'letters', duration: 0.7 } },
        { type: 'text', text: 'northwind.example', x: 0.5, y: 0.58, size: 38, weight: 500, color: 'accent', at: 0.6, in: 'fade' },
      ],
    },
  ],
};

export const EXAMPLE_CHART = {
  format: 'lmg.scene/1',
  title: 'Quarterly growth',
  aspect: '16:9',
  style: 'paper',
  scenes: [
    {
      duration: 4,
      layers: [
        { type: 'text', text: 'Revenue by quarter', x: 0.1, y: 0.16, anchor: 'left', align: 'left', size: 64, weight: 700, in: 'mask-up' },
        { type: 'bars', values: [12, 18, 27, 41], labels: ['Q1', 'Q2', 'Q3', 'Q4'], suffix: 'k', x: 0.5, y: 0.56, w: 1200, h: 520, color: 'accent', at: 0.3, in: { preset: 'grow', duration: 1.6 } },
      ],
    },
    {
      duration: 3.5,
      transition: { kind: 'wipe', direction: 'left' },
      layers: [
        { type: 'line-chart', values: [3, 5, 4, 8, 11, 10, 15], x: 0.5, y: 0.5, w: 1300, h: 520, color: 'accent', area: true, in: { preset: 'draw', duration: 2 } },
        { type: 'text', text: 'Up and to the right', x: 0.5, y: 0.86, size: 48, weight: 600, highlight: ['right'], hold: 'marker', at: 0.6, in: 'rise' },
      ],
    },
  ],
};

export const EXAMPLES = { launch: EXAMPLE_LAUNCH, chart: EXAMPLE_CHART };
