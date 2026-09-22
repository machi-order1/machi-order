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
  function alcoholDrinks(data) {
    if (data.ordering?.enabled === false || data.ordering?.is_open === false) return [];
    const ids = new Set((data.categories || []).filter(c => c.name === 'アルコール').map(c => Number(c.id)));
    return (data.products || []).filter(p => ids.has(Number(p.category_id)) && p.sale_status === 'available');
  }
  function containsAlcohol(data, items) {
    const ids = new Set((data.categories || []).filter(c => c.name === 'アルコール').map(c => Number(c.id)));
    return items.some(item => (data.products || []).some(p => Number(p.id) === Number(item.product_id) && ids.has(Number(p.category_id))));
  }
  function renderHappy(data, escape, yen, pinned = false) {
    const discounted = happyDrinks(data);
    const drinks = discounted.length ? discounted : pinned ? alcoholDrinks(data) : [];
    if (!drinks.length) return '';
    const ends = [...new Set(discounted.map(product => product.price_rule_end_time?.slice(0, 5)).filter(Boolean))];
    return `<div class="happy-heading"><div><span class="happy-eyebrow">${discounted.length ? 'HAPPY HOUR' : 'お酒を追加'}</span><h2>お得な一杯を、すぐ注文。</h2><p>お酒だけでもどうぞ</p></div>${ends.length === 1 ? `<b class="happy-end">${escape(ends[0])}まで</b>` : ''}</div><div class="happy-drinks">${drinks.slice(0, 3).map(product => `<div class="happy-drink"><strong>${escape(product.name)}</strong>${product.price_type === 'happy_hour' && Number(product.regular_price) > Number(product.price) ? `<s>通常 ${yen(product.regular_price)}</s>` : ''}<b class="happy-amount">${yen(product.price)}</b><button type="button" data-happy-product="${Number(product.id)}">${(product.option_group_ids || []).length ? '選ぶ' : 'カートに追加'}</button></div>`).join('')}</div><div class="happy-bottom"><button type="button" id="happy-view-all">お酒のメニューを見る →</button><span id="happy-added" role="status" aria-live="polite"></span></div>`;
  }
  global.CustomerPromotions = Object.freeze({ recommendations, happyDrinks, alcoholDrinks, containsAlcohol, renderHappy });
})(window);
