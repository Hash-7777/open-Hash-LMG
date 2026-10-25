// The models each service offers, asked of the service itself and kept while
// the app runs, so a picker fills at once and stays current: a list older than
// ten minutes is asked for again whenever a picker opens.
//
// A service is offered when it can be used now: a cloud service whose key is
// saved, or a model app on this computer that answered with at least one model.

import { PROVIDERS, LOCAL_IDS, CLOUD_IDS } from '../core/providers/catalog.js';
import { listModels } from '../core/providers/client.js';
import { fetchFor } from '../platform/index.js';

const FRESH_MS = 10 * 60 * 1000;

export function createModelLists(settings) {
  // id -> { list, at, error, loading }
  const lists = new Map();
  const listeners = new Set();
  const emit = () => { for (const fn of listeners) fn(); };

  function entry(id) {
    if (!lists.has(id)) lists.set(id, { list: [], at: 0, error: '', loading: null });
    return lists.get(id);
  }

  // Asks the service for its models, unless a fresh list is already kept.
  function refresh(id, { force = false } = {}) {
    const e = entry(id);
    if (e.loading) return e.loading;
    if (!force && e.at && Date.now() - e.at < FRESH_MS) return Promise.resolve(e.list);
    if (PROVIDERS[id]?.kind === 'cloud' && !settings.hasKey(id)) { e.list = []; e.error = ''; return Promise.resolve([]); }
    e.loading = (async () => {
      try {
        e.list = await listModels(id, { key: settings.key(id), keyHeld: settings.keyHeld(), base: settings.base(id), fetch: fetchFor(id) });
        e.error = '';
      } catch (err) {
        e.list = [];
        e.error = err.message || String(err);
      } finally {
        e.at = Date.now();
        e.loading = null;
        emit();
      }
      return e.list;
    })();
    emit();
    return e.loading;
  }

  // Every service worth asking: the apps on this computer, and the cloud
  // services with a key.
  const candidates = () => [...LOCAL_IDS, ...CLOUD_IDS.filter((id) => settings.hasKey(id))];

  return {
    refresh,
    refreshAll: (opts) => Promise.all(candidates().map((id) => refresh(id, opts))),
    // { list, at, error, loading } for one service.
    get: (id) => entry(id),
    // The services that can be used now, in the catalog's order.
    usable: () => candidates().filter((id) => PROVIDERS[id].kind === 'cloud' || entry(id).list.length > 0),
    // Cloud services with no key yet, to point at Settings.
    keyless: () => CLOUD_IDS.filter((id) => !settings.hasKey(id)),
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
