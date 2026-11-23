// Слияние данных двух устройств (iPhone ↔ iPad) без сервера: по id и времени изменения,
// с учётом журнала удалений. Чистая функция.

const COLLS = ['txns', 'categories', 'recurring', 'debts', 'tasks', 'notes', 'goals', 'accounts', 'templates', 'invest'];
const stamp = (x) => x?.updatedAt || x?.createdAt || 0;

export function mergeStates(local, remote) {
  const out = JSON.parse(JSON.stringify(local));
  const deleted = { ...(local.deleted || {}) };
  for (const [id, ts] of Object.entries(remote.deleted || {})) deleted[id] = Math.max(deleted[id] || 0, ts);
  const stats = { added: 0, updated: 0, removed: 0 };

  for (const c of COLLS) {
    const map = new Map((local[c] || []).map((x) => [x.id, x]));
    for (const r of remote[c] || []) {
      const l = map.get(r.id);
      if (!l) { if (!(deleted[r.id] >= stamp(r))) { map.set(r.id, r); stats.added++; } }
      else if (stamp(r) > stamp(l)) { map.set(r.id, r); stats.updated++; }
    }
    for (const [id, x] of map) {
      if (deleted[id] && deleted[id] >= stamp(x)) {
        map.delete(id);
        if ((local[c] || []).some((y) => y.id === id)) stats.removed++;
      }
    }
    out[c] = [...map.values()];
  }

  // журнал удалений храним полгода
  const cutoff = Date.now() - 183 * 864e5;
  out.deleted = Object.fromEntries(Object.entries(deleted).filter(([, ts]) => ts > cutoff));
  out.dismissed = [...new Set([...(local.dismissed || []), ...(remote.dismissed || [])])].slice(-500);
  out.focus = { ...(remote.focus || {}) };
  for (const [d, m] of Object.entries(local.focus || {})) out.focus[d] = Math.max(out.focus[d] || 0, m);

  const ls = out.settings, rs = remote.settings || {};
  ls.currencies = [...new Set([...(ls.currencies || []), ...(rs.currencies || [])])];
  ls.manualRates = { ...(rs.manualRates || {}), ...(ls.manualRates || {}) };
  ls.rates = { ...(rs.rates || {}), ...(ls.rates || {}) };
  if ((remote.market?.at || 0) > (local.market?.at || 0)) out.market = remote.market;
  out.schema = Math.max(local.schema || 1, remote.schema || 1);
  return { state: out, stats };
}
