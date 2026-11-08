// A sound encoder's start-up delay, taken out before encoding.
//
// An MP4 or MOV from this app carries no edit list (mp4.js), so the delay an
// encoder puts at the front of its output cannot be skipped by the player.
// Instead the sound is moved that many samples earlier before it is encoded:
// what the encoder adds at the front lands where those samples were, and the
// film's picture and sound start together. The end is filled with silence so
// the length stays the same.

// Start-up delays, in samples: the system's AAC encoder, and the app's MP3
// encoder with a decoder's own, as measured on the decoded sound.
export const AAC_SYSTEM_DELAY = 2112;
export const MP3_DELAY = 2257;

// st: { left, right, sampleRate }. Returns the same sound moved n samples earlier.
export function ahead(st, n) {
  if (!n) return st;
  const move = (x) => { const out = new Float32Array(x.length); out.set(x.subarray(Math.min(n, x.length))); return out; };
  return { ...st, left: move(st.left), right: move(st.right) };
}
