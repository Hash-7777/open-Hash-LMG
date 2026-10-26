// The narration's words grouped into the phrases a caption shows one at a
// time: up to six words, broken after punctuation where possible. A word or
// two left over before a stop joins the phrase before it, so a caption never
// ends a line on one word that the next caption finishes alone.
//
// words: [[text, start, end], ...]; returns lists of word indexes.

const STOP = /[.,;:?!]$/;
const MOST = 6;
const WITH_TAIL = 8;

export function captionPhrases(words) {
  const phrases = [];
  let cur = [];
  words.forEach((w, i) => {
    cur.push(i);
    const stop = STOP.test(w[0]);
    const prev = phrases[phrases.length - 1];
    if (stop && cur.length <= 2 && prev && !STOP.test(words[prev[prev.length - 1]][0]) && prev.length + cur.length <= WITH_TAIL) {
      prev.push(...cur);
      cur = [];
    } else if (cur.length >= MOST || stop) {
      phrases.push(cur);
      cur = [];
    }
  });
  if (cur.length) phrases.push(cur);
  return phrases;
}
