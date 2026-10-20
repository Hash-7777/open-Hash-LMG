// Export: the film written to an MP4 or MOV, frame by frame, with its sound.
//
// Frames are drawn by a render host of the export's own, so the editor stays
// usable, and the soundtrack is the same one the preview plays.

import { h, clear, dialog } from './dom.js';
import { field, pair, segmented, select, textButton } from './fields.js';
import { createHost } from '../render/host.js';
import { renderVideo, canEncodeVideo } from '../render/export.js';
import { soundtrackFor } from './soundtrack.js';
import { saveFile, encodeAacNative } from '../platform/index.js';

const QUALITY = [['draft', 'Draft: small file'], ['good', 'Good'], ['high', 'High'], ['master', 'Master: largest file']];
const BLUR = [['0', 'Off'], ['4', 'Soft'], ['8', 'Full']];

function fileName(title, ext) {
  const base = String(title || 'film').normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'film';
  return `${base}.${ext}`;
}

export function openExportDialog({ store, settings }) {
  let abort = null;
  const d = dialog({ title: 'Export', onClose: () => { if (abort) abort.abort(); } });
  const form = h('div');
  const progress = h('div', { class: 'export-progress', hidden: true });
  const bar = h('div', { class: 'progress' }, h('div', { class: 'progress-fill' }));
  const phase = h('div', { class: 'field-hint' });
  progress.append(bar, phase);
  const actions = h('div', { class: 'dialog-actions' });
  d.body.append(form, progress, actions);

  function paint() {
    const s = settings.get().export;
    const scene = store.get().project.scene;
    const set = (patch) => { settings.update({ export: patch }); paint(); };
    clear(form).append(
      h('p', { class: 'insp-note', text: `${scene.width} × ${scene.height}, ${scene.fps} frames a second, ${scene.duration.toFixed(1)} seconds.` }),
      field('File', segmented(s.container, [['mp4', 'MP4'], ['mov', 'MOV']], (v) => set({ container: v })), s.container === 'mov' ? 'For editing apps such as Final Cut Pro and Premiere.' : 'Plays everywhere and uploads to every platform.'),
      pair(
        field('Quality', select(s.quality, QUALITY, (v) => set({ quality: v }))),
        field('Motion blur', select(String(s.blur), BLUR, (v) => set({ blur: Number(v) })))),
      s.blur ? h('div', { class: 'field-hint', text: 'Motion blur draws each frame several times, so the export takes that much longer.' }) : null);
    if (!canEncodeVideo()) form.append(h('p', { class: 'insp-note warn', text: 'This system has no video encoder the app can use, so a film cannot be written here.' }));
    clear(actions).append(textButton('Cancel', () => d.close()), h('button', { class: 'primary-btn', type: 'button', text: 'Export', disabled: !canEncodeVideo(), onclick: run }));
  }

  async function run() {
    const s = settings.get().export;
    const { project } = store.get();
    const scene = project.scene;
    abort = new AbortController();
    form.hidden = true;
    progress.hidden = false;
    clear(actions).append(textButton('Stop', () => abort.abort()));
    const fill = bar.firstChild;
    const show = (text, f) => { phase.textContent = text; fill.style.width = `${Math.round(Math.max(0, Math.min(1, f)) * 100)}%`; };
    const host = createHost();
    try {
      show('Making the sound', 0);
      const soundtrack = await soundtrackFor(scene);
      await host.setScene(scene);
      if (project.code) await host.setCode(project.code);
      const out = await renderVideo({
        host, scene, quality: s.quality, container: s.container,
        blur: s.blur ? { samples: s.blur, shutter: 0.5 } : null,
        soundtrack, encodeAacNative, signal: abort.signal,
        onProgress: ({ phase: p, done, total }) => {
          if (p === 'frames') show(`Drawing frame ${done.toLocaleString()} of ${total.toLocaleString()}`, (done / total) * 0.94);
          else if (p === 'sound') show('Encoding the sound', 0.96);
          else if (p === 'file') show('Writing the file', 0.98);
        },
      });
      show('Saving', 1);
      const saved = await saveFile(fileName(scene.title, s.container), out.file, s.container === 'mov' ? 'video/quicktime' : 'video/mp4');
      if (saved && out.wav) await saveFile(fileName(scene.title, 'wav'), out.wav, 'audio/wav');
      clear(progress).append(h('p', { class: 'insp-note', text: saved ? 'The film is saved.' : 'Not saved.' }), ...out.notes.map((n) => h('p', { class: 'insp-note warn', text: n })));
    } catch (err) {
      clear(progress).append(h('p', { class: `insp-note${abort.signal.aborted ? '' : ' warn'}`, text: abort.signal.aborted ? 'Export stopped.' : err.message || String(err) }));
    } finally {
      host.dispose();
      abort = null;
      clear(actions).append(textButton('Close', () => d.close()));
    }
  }

  paint();
  return d;
}
