(function (global) {
  'use strict';
  const maxAge = 12 * 60 * 60 * 1000;
  function restore(raw, now = Date.now()) {
    try { const rows = JSON.parse(raw || '[]'); return Array.isArray(rows) ? rows.filter(row => row && Number.isFinite(Number(row.product_id)) && Array.isArray(row.option_ids) && Array.isArray(row.option_names) && Number(row.at) <= now && now - Number(row.at) < maxAge).slice(-100) : []; } catch { return []; }
  }
  function remember(history, items, data, now = Date.now()) {
    const result = restore(JSON.stringify(history), now);
    for (const item of items) {
      const product = data.products.find(p => Number(p.id) === Number(item.product_id));
      const ids = (item.option_ids || []).map(Number).sort((a,b) => a-b);
      const key = Number(item.product_id) + ':' + ids.join(',');
      const index = result.findIndex(row => row.key === key);
      const row = { key, product_id: Number(item.product_id), category_id: Number(product?.category_id), name: item.name, option_ids: ids, option_names: [...(item.option_names || [])], at: now };
      if (index >= 0) result.splice(index, 1);
      result.push(row);
    }
    return result.slice(-100);
  }
  function selection(product, ids, data) {
    return Object.fromEntries((product.option_group_ids || []).map(id => data.option_groups.find(g => Number(g.id) === Number(id))).filter(Boolean).map(group => [group.id, ids.map(Number).filter(id => (group.options || []).some(o => Number(o.id) === id && o.available !== false))]));
  }
  function entries(history, data) {
    // Alcohol, soft drinks, a-la-carte, sets/rice, noodles.
    const rank = [5,6,3,2,1];
    return history.map(row => {
      const product = data.products.find(p => Number(p.id) === row.product_id);
      if (!product) return { ...row, available: false, needsReview: true, price: null };
      const groups = (product.option_group_ids || []).map(id => data.option_groups.find(g => Number(g.id) === Number(id))).filter(Boolean);
      const chosen = selection(product, row.option_ids, data);
      const ids = Object.values(chosen).flat();
      const missing = row.option_ids.some(id => !ids.includes(Number(id)));
      const invalid = groups.some(g => {
        const count = (chosen[g.id] || []).length;
        return count < Math.max(Number(g.min_select || 0), g.required ? 1 : 0) || count > Number(g.max_select || 1);
      });
      const delta = groups.flatMap(g => g.options || []).filter(o => ids.includes(Number(o.id))).reduce((sum,o) => sum + Number(o.price_delta || 0), 0);
      return { ...row, category_id: Number(product.category_id), name: product.name, available: product.sale_status === 'available', needsReview: missing || invalid, price: missing || invalid ? null : Number(product.price) + delta };
    }).sort((a,b) => (rank.includes(a.category_id) ? rank.indexOf(a.category_id) : 99) - (rank.includes(b.category_id) ? rank.indexOf(b.category_id) : 99) || b.at - a.at);
  }
  global.CustomerRefill = Object.freeze({ restore, remember, selection, entries });
})(window);
