// One film as three see-through layers: its backgrounds alone, its shapes,
// and its words. A product film lifts a made film off its screen this way and
// parts the three in depth.
//
// Each of the shapes and words layers keeps every scene apart (parts), and a
// white stand-in for each scene's background (covers), so that while two
// scenes cross, the arriving scene erases what its own background would have
// hidden of the leaving one, as it does in the film itself.
//
// The renderer is passed in (R = { renderPlan, activeScenes }) so this module
// does not import the renderer that draws stages.

const WORDS = new Set(['text', 'counter']);
const CLEAR = 'rgba(0,0,0,0)';

export function layersOf(doc) {
  const only = (keep) => {
    const film = {
      ...doc,
      background: { ...doc.background, kind: 'none', color: CLEAR },
      voice: { ...doc.voice, captions: false },
      scenes: doc.scenes.map((S) => ({ ...S, background: CLEAR, layers: S.layers.filter(keep) })),
    };
    const blank = (S) => ({ ...S, layers: [] });
    return {
      doc: film,
      parts: film.scenes.map((_, i) => ({ ...film, scenes: film.scenes.map((S, j) => (j === i ? S : blank(S))) })),
      covers: film.scenes.map((_, i) => ({ ...film, scenes: film.scenes.map((S, j) => ({ ...blank(S), background: j === i ? '#ffffff' : CLEAR })) })),
    };
  };
  return {
    back: { ...doc, voice: { ...doc.voice, captions: false }, scenes: doc.scenes.map((S) => ({ ...S, layers: [] })) },
    shapes: only((L) => !WORDS.has(L.type)),
    words: only((L) => WORDS.has(L.type)),
  };
}

// Draws one see-through layer at t into kit's canvas (already cleared).
// mask = { c, kit }: a scratch canvas of the same size for the covers.
export function drawFilmLayer(kit, layer, t, mask, R) {
  const alive = R.activeScenes(layer.doc, Math.min(t, layer.doc.duration - 1e-4));
  if (alive.length < 2) { R.renderPlan(kit, layer.doc, t); return; }
  alive.forEach((A, n) => {
    if (n > 0) {
      const m = mask.kit.ctx;
      m.save(); m.setTransform(1, 0, 0, 1, 0, 0); m.clearRect(0, 0, mask.c.width, mask.c.height); m.restore();
      R.renderPlan(mask.kit, layer.covers[A.index], t);
      const g = kit.ctx;
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = 'destination-out';
      g.drawImage(mask.c, 0, 0);
      g.restore();
    }
    R.renderPlan(kit, layer.parts[A.index], t);
  });
}

export const FILM_LAYERS = ['back', 'shapes', 'words'];
