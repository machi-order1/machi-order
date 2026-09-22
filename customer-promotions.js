(function (global) {
  'use strict';
  const recommendedIds = [5, 6, 16, 20];
  function recommendations(data) {
    return recommendedIds.map(id => (data.products || []).find(product => Number(product.id) === id)).filter(Boolean);
  }
  function happyDrinks(data) {
    if (data.ordering?.enabled === false || data.ordering?.is_open === false) return [];
    const categories = new Set((data.categories || []).filter(category => category.name === 'アルコール').map(category => Number(category.id)));
    const preferred = [29, 30, 31];
    const rank = product => preferred.includes(Number(product.id)) ? preferred.indexOf(Number(product.id)) : 99;
    return (data.products || []).filter(product => categories.has(Number(product.category_id)) && product.price_type === 'happy_hour' && product.sale_status === 'available' && Number(product.regular_price) > Number(product.price))
      .sort((a, b) => rank(a) - rank(b));
  }
  function renderHappy(data, escape, yen) {
    const drinks = happyDrinks(data);
    if (!drinks.length) return '';
    const ends = [...new Set(drinks.map(product => product.price_rule_end_time?.slice(0, 5)).filter(Boolean))];
    return `<div class="happy-heading"><div><span class="happy-eyebrow">HAPPY HOUR</span><h2>まずは、お得な一杯から。</h2><p>お酒だけのご注文もどうぞ</p></div>${ends.length === 1 ? `<b class="happy-end">${escape(ends[0])}まで</b>` : ''}</div><div class="happy-drinks">${drinks.slice(0, 3).map(product => `<div class="happy-drink"><strong>${escape(product.name)}</strong><s>通常 ${yen(product.regular_price)}</s><b class="happy-amount">${yen(product.price)}</b><small>${yen(Number(product.regular_price) - Number(product.price))}お得</small><button type="button" data-happy-product="${Number(product.id)}">${(product.option_group_ids || []).length ? '選ぶ' : 'カートに追加'}</button></div>`).join('')}</div><div class="happy-bottom"><button type="button" id="happy-view-all">対象のお酒を見る →</button><span id="happy-added" role="status" aria-live="polite"></span></div>`;
  }
  global.CustomerPromotions = Object.freeze({ recommendations, happyDrinks, renderHappy });
})(window);
