// Export: the film written to a video (MP4, MOV), an animation (GIF), a still
// (PNG) or its sound alone (WAV, MP3), at a chosen size and frame rate.
//
// Frames are drawn by a render host of the export's own, at the export's size,
// so the editor stays usable, and the soundtrack is the same one the preview
// plays. In the desktop app every format is encoded by the app's own encoders.

import { h, clear, fill, dialog } from './dom.js';
import { field, pair, select, textButton } from './fields.js';
import { createHost } from '../render/host.js';
import { renderVideo, renderStill, canEncodeVideo } from '../render/export.js';
import { canEncodeGif } from '../render/encoders.js';
import { exportSize, exportFps, sizeLabel } from '../core/export/sizes.js';
import { encodeWav } from '../core/audio/wav.js';
import { RESOLUTIONS, EXPORT_FPS } from '../platform/settings.js';
import { soundtrackFor } from './soundtrack.js';
import { saveFile, encodeAacNative, nativeEncoder } from '../platform/index.js';

const QUALITY = [['draft', 'Draft: small file'], ['good', 'Good'], ['high', 'High'], ['master', 'Master: largest file']];
const BLUR = [['0', 'Off'], ['4', 'Soft'], ['8', 'Full']];
const FORMATS = {
  mp4: { label: 'MP4 video', hint: 'Plays everywhere and uploads to every platform.', mime: 'video/mp4' },
  mov: { label: 'MOV video', hint: 'For video editing apps. To send to a phone or a chat app, choose MP4.', mime: 'video/quicktime' },
  gif: { label: 'GIF animation', hint: 'Loops by itself, with no sound. Kept small: GIFs grow large quickly.', mime: 'image/gif' },
  png: { label: 'PNG picture', hint: 'The frame under the playhead, as a picture.', mime: 'image/png' },
  wav: { label: 'WAV sound', hint: 'The soundtrack alone, at full quality.', mime: 'audio/wav' },
  mp3: { label: 'MP3 sound', hint: 'The soundtrack alone, small.', mime: 'audio/mpeg' },
};
const VIDEO = new Set(['mp4', 'mov', 'gif']);
// GIFs stay small: a short side of 480 and 15 frames a second unless chosen smaller.
const GIF_SIDE = 480, GIF_FPS = 15;

function fileName(title, ext) {
  const base = String(title || 'film').normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'film';
  return `${base}.${ext}`;
}

function available(fmt) {
  if (fmt === 'gif' || fmt === 'mp3') return nativeEncoder.available && (fmt !== 'gif' || canEncodeGif());
  if (fmt === 'mp4' || fmt === 'mov') return canEncodeVideo();
  return true;
}

export function openExportDialog({ store, settings, playhead = () => 0 }) {
  let abort = null;
  const d = dialog({ title: 'Export', onClose: () => { if (abort) abort.abort(); } });
  const form = h('div');
  const progress = h('div', { class: 'export-progress', hidden: true });
  const bar = h('div', { class: 'progress' }, h('div', { class: 'progress-fill' }));
  const phase = h('div', { class: 'field-hint' });
  progress.append(bar, phase);
  const actions = h('div', { class: 'dialog-actions' });
  d.body.append(form, progress, actions);

  // The size and rate the export will really be drawn at.
  function plan() {
    const s = settings.get().export;
    const scene = store.get().project.scene;
    const gif = s.container === 'gif';
    const side = gif ? Math.min(s.size || GIF_SIDE, 720) : s.size;
    const fps = gif ? Math.min(exportFps(scene, s.fps), 25) : exportFps(scene, s.fps);
    return { ...exportSize(scene, side), fps: gif && !s.fps ? GIF_FPS : fps };
  }

  function paint() {
    const s = settings.get().export;
    const scene = store.get().project.scene;
    const set = (patch) => { settings.update({ export: patch }); paint(); };
    const p = plan();
    const fmt = FORMATS[s.container];
    const video = VIDEO.has(s.container);
    fill(form,
      field('Format', select(s.container, Object.entries(FORMATS).map(([k, f]) => [k, available(k) ? f.label : `${f.label} (desktop app)`]), (v) => set({ container: v })), fmt.hint),
      s.container !== 'wav' && s.container !== 'mp3' ? pair(
        field('Size', select(String(s.size), RESOLUTIONS.map((r) => [String(r), r ? sizeLabel(r) : `The film’s own, ${scene.width} × ${scene.height}`]), (v) => set({ size: Number(v) }))),
        video ? field('Frame rate', select(String(s.fps), EXPORT_FPS.map((f) => [String(f), f ? `${f} a second` : `The film’s own, ${scene.fps}`]), (v) => set({ fps: Number(v) }))) : h('span')) : null,
      s.container === 'mp4' || s.container === 'mov' ? pair(
        field('Quality', select(s.quality, QUALITY, (v) => set({ quality: v }))),
        field('Motion blur', select(String(s.blur), BLUR, (v) => set({ blur: Number(v) })))) : null,
      h('p', { class: 'insp-note', text: s.container === 'wav' || s.container === 'mp3'
        ? `${scene.duration.toFixed(1)} seconds of sound.`
        : s.container === 'png' ? `${p.width} × ${p.height}, the frame at ${playhead().toFixed(2)} s.`
          : `${p.width} × ${p.height}, ${p.fps} frames a second, ${scene.duration.toFixed(1)} seconds: ${Math.round(scene.duration * p.fps).toLocaleString()} frames.` }),
      video && s.blur && s.container !== 'gif' ? h('div', { class: 'field-hint', text: 'Motion blur draws each frame several times, so the export takes that much longer.' }) : null,
      available(s.container) ? null : h('p', { class: 'insp-note warn', text: 'This format is made by the desktop app’s own encoder.' }));
    clear(actions).append(textButton('Cancel', () => d.close()), h('button', { class: 'primary-btn', type: 'button', text: 'Export', disabled: !available(s.container), onclick: run }));
  }

  async function run() {
    const s = settings.get().export;
    const { project } = store.get();
    const scene = project.scene;
    const p = plan();
    abort = new AbortController();
    form.hidden = true;
    progress.hidden = false;
    clear(actions).append(textButton('Stop', () => abort.abort()));
    const fill = bar.firstChild;
    const show = (text, f) => { phase.textContent = text; fill.style.width = `${Math.round(Math.max(0, Math.min(1, f)) * 100)}%`; };
    const started = Date.now();
    const host = createHost();
    let out = { notes: [] };
    try {
      const fmt = s.container;
      let file = null, wav = null;
      if (fmt === 'wav' || fmt === 'mp3') {
        show('Making the sound', 0.2);
        const st = await soundtrackFor(scene);
        if (!st) throw new Error('This film has no sound to export.');
        show('Encoding the sound', 0.7);
        file = fmt === 'wav' ? encodeWav(st.left, st.right, st.sampleRate) : await nativeEncoder.mp3(st.left, st.right, st.sampleRate);
      } else {
        await host.setScene({ ...scene, width: p.width, height: p.height });
        if (project.code) await host.setCode(project.code);
        if (fmt === 'png') {
          show('Drawing the frame', 0.5);
          file = await renderStill(host, playhead());
        } else {
          const soundtrack = fmt === 'gif' ? null : (show('Making the sound', 0), await soundtrackFor(scene));
          out = await renderVideo({
            host, scene, format: fmt, width: p.width, height: p.height, fps: p.fps, quality: s.quality,
            blur: s.blur && fmt !== 'gif' ? { samples: s.blur, shutter: 0.5 } : null,
            soundtrack, encodeAacNative, signal: abort.signal,
            onProgress: ({ phase: ph, done, total }) => {
              if (ph === 'frames') {
                const secs = (Date.now() - started) / 1000;
                const left = done > 10 ? Math.max(0, Math.round((secs / done) * (total - done))) : null;
                show(`Frame ${done.toLocaleString()} of ${total.toLocaleString()}${left !== null ? `, about ${left < 60 ? `${left} s` : `${Math.round(left / 60)} min`} left` : ''}`, (done / total) * 0.94);
              } else if (ph === 'sound') show('Encoding the sound', 0.96);
              else if (ph === 'file') show('Writing the file', 0.98);
            },
          });
          file = out.file;
          wav = out.wav;
        }
      }
      show('Saving', 1);
      const saved = await saveFile(fileName(scene.title, fmt), file, FORMATS[fmt].mime);
      if (saved && wav) await saveFile(fileName(scene.title, 'wav'), wav, 'audio/wav');
      clear(progress).append(h('p', { class: 'insp-note', text: saved ? `Saved, in ${Math.max(1, Math.round((Date.now() - started) / 1000))} s.` : 'Not saved.' }), ...(out.notes || []).map((n) => h('p', { class: 'insp-note warn', text: n })));
    } catch (err) {
      const stopped = abort.signal.aborted || err.stopped;
      clear(progress).append(h('p', { class: `insp-note${stopped ? '' : ' warn'}`, text: stopped ? 'Export stopped.' : err.message || String(err) }));
    } finally {
      host.dispose();
      abort = null;
      clear(actions).append(textButton('Close', () => d.close()));
    }
  }

  paint();
  return d;
}
