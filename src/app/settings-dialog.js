// Settings: which model makes the film, where it runs, and how the editor
// looks. Every change is saved as it is made.

import { h, clear, dialog, toast } from './dom.js';
import { field, section, select, segmented, toggle, textButton } from './fields.js';
import { PROVIDERS, LOCAL_IDS, CLOUD_IDS } from '../core/providers/catalog.js';
import { modelProfile } from '../core/providers/models.js';
import { listModels } from '../core/providers/client.js';

const SIZE_WORDS = { small: 'small', medium: 'mid-size', large: 'large', frontier: 'frontier' };
const TIER_WORDS = { guided: 'Guided', plan: 'Plan', code: 'Code' };

export function openSettingsDialog({ settings }) {
  const d = dialog({ title: 'Settings', wide: true });
  const modelBox = h('div');
  const lookBox = h('div');
  d.body.append(modelBox, lookBox);
  let models = [];
  let loading = null;

  function paintModel() {
    const s = settings.get();
    const id = s.model.provider;
    const p = PROVIDERS[id];

    const service = h('select', { class: 'input select' });
    const group = (label, ids) => h('optgroup', { label }, ...ids.map((x) => {
      const o = h('option', { value: x, text: PROVIDERS[x].label });
      if (x === id) o.selected = true;
      return o;
    }));
    service.append(group('On this computer', LOCAL_IDS), group('In the cloud, with your own key', CLOUD_IDS));
    service.addEventListener('change', () => {
      models = [];
      settings.update({ model: { provider: service.value, model: '' } });
      paintModel();
      refresh();
    });

    const where = [];
    if (p.kind === 'local') {
      const port = h('input', { class: 'input num', type: 'number', min: '1', max: '65535', value: String(s.local.ports[id]) });
      port.addEventListener('change', () => { settings.update({ local: { ports: { ...settings.get().local.ports, [id]: Number(port.value) } } }); refresh(); });
      where.push(field('Port', port, p.help));
      where.push(field('Runs on', id === 'ollama'
        ? segmented(s.local.device, [['auto', 'Automatic'], ['cpu', 'Processor'], ['gpu', 'Graphics chip']], (v) => { settings.update({ local: { device: v } }); paintModel(); })
        : h('div', { class: 'readout', text: 'Chosen in the app when the model is loaded' }),
      id === 'ollama' ? 'The processor leaves the graphics chip free for other work; the graphics chip is faster when the model fits in its memory.' : null));
    } else {
      const key = h('input', { class: 'input', type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: settings.hasKey(id) ? 'Saved. Type to replace it.' : 'Paste your key' });
      key.addEventListener('change', () => {
        if (!key.value.trim()) return;
        settings.setKey(id, key.value.trim());
        key.value = '';
        key.placeholder = 'Saved. Type to replace it.';
        refresh();
      });
      const forget = settings.hasKey(id) ? textButton('Forget the key', () => { settings.setKey(id, ''); paintModel(); }) : null;
      where.push(field('Key', key, `Get one at ${p.keyHint}. It is kept on this computer, not encrypted, and sent only to ${p.label}.`));
      if (forget) where.push(forget);
    }

    const listId = `models-${id}`;
    const modelInput = h('input', { class: 'input', type: 'text', list: listId, value: s.model.model, placeholder: 'Model name', spellcheck: 'false' });
    modelInput.addEventListener('change', () => { settings.update({ model: { model: modelInput.value.trim() } }); paintModel(); });
    const options = h('datalist', { id: listId }, ...models.map((m) => h('option', { value: m.id, text: m.label !== m.id ? m.label : '' })));
    const status = h('span', { class: 'field-hint', text: loading ? 'Looking for models' : models.length ? `${models.length} available` : '' });
    const prof = s.model.model ? modelProfile(id, s.model.model, (models.find((m) => m.id === s.model.model) || {}).meta || {}) : null;
    const about = prof ? `${prof.params ? `About ${prof.params < 1 ? prof.params.toFixed(1) : Math.round(prof.params)}B parameters, ` : ''}${SIZE_WORDS[prof.size]}. Suggested way of working: ${TIER_WORDS[prof.tier]}.${prof.vision ? ' It can see pictures, so it can review stills.' : ''}` : 'Choose a model, or type its name.';

    clear(modelBox).append(section('Model',
      field('Service', service),
      ...where,
      field('Model', h('div', { class: 'row' }, modelInput, textButton('Refresh', () => refresh())), about),
      options,
      status,
      field('Review', toggle(s.model.review, (v) => settings.update({ model: { review: v } }), 'Let a model that can see review stills and ask for changes once'))));
  }

  async function refresh() {
    const s = settings.get();
    const id = s.model.provider;
    if (PROVIDERS[id].kind === 'cloud' && !settings.hasKey(id)) { models = []; paintModel(); return; }
    const mine = loading = {};
    paintModel();
    try {
      const list = await listModels(id, { key: settings.key(id), base: settings.base(id), fetch: (u, i) => fetch(u, i) });
      if (loading !== mine || settings.get().model.provider !== id) return;
      models = list;
      if (!settings.get().model.model && list.length) settings.update({ model: { model: list[0].id } });
    } catch (err) {
      if (loading === mine) toast(err.message || String(err), 'error');
      models = [];
    } finally {
      if (loading === mine) { loading = null; paintModel(); }
    }
  }

  function paintLook() {
    const s = settings.get();
    clear(lookBox).append(section('Appearance',
      field('Theme', segmented(s.appearance.theme, [['system', 'Match the system'], ['dark', 'Dark'], ['light', 'Light']], (v) => { settings.update({ appearance: { theme: v } }); paintLook(); }))));
  }

  paintModel();
  paintLook();
  refresh();
  return d;
}
