(function (global) {
  'use strict';
  const ingredients = new Set(['白ネギの量', '青ネギの量', 'キクラゲの量', '高菜の量']);
  const order = ['追加トッピング', '白ネギの量', '青ネギの量', 'キクラゲの量', '高菜の量'];
  const toppingPhotos = {9: 'extra-chashu.webp', 11: 'spicy-takana.webp', 12: 'raw-egg.webp', 13: 'half-boiled-egg.webp', 14: 'iki-premium-beef.webp'};
  function sorted(groups) {
    const rank = group => order.includes(group.name) ? order.indexOf(group.name) + 1 : 0;
    return [...groups].sort((a, b) => rank(a) - rank(b));
  }
  function priceLabel(delta, yen) {
    return Number(delta) > 0 ? `＋${yen(delta)}` : Number(delta) < 0 ? `−${yen(-delta)}` : '追加料金なし';
  }
  function render(groups, selected, escape, yen) {
    return sorted(groups).map(group => {
      const chosen = selected[group.id] || [];
      const ingredient = ingredients.has(group.name);
      if (group.name === '追加トッピング') {
        return `<section class="bowl-options topping-options"><h3>この一杯にトッピング</h3><div class="topping-strip" role="group" aria-label="追加トッピング・複数選択できます">${(group.options || []).map(option => {
          const active = chosen.includes(Number(option.id));
          const disabled = option.available === false;
          const name = option.name.replace(/^追加トッピング：/, '').replace(/^追加\s*/, '');
          const label = name.replace('炙りチャーシュー', '炙り焼豚').replace('自家製激辛高菜', '激辛高菜').replace('壱岐牛プレミアムローストビーフ', '壱岐牛');
          const photo = toppingPhotos[Number(option.source_product_id)];
          return `<button type="button" aria-label="${escape(name)} ${escape(priceLabel(option.price_delta, yen))}" class="choice topping-chip ${active ? 'sel on' : ''}" data-group="${Number(group.id)}" data-option="${Number(option.id)}" data-max="${Number(group.max_select || 1)}" aria-pressed="${active}" ${disabled ? 'disabled' : ''}>${photo ? `<img src="/assets/menu-items/web/${photo}" alt="" width="36" height="36">` : '<span class="topping-symbol" aria-hidden="true">＋</span>'}<span class="topping-name">${escape(label)}</span><span class="topping-price">${disabled ? '売り切れ' : escape(priceLabel(option.price_delta, yen))}</span><span class="topping-check" aria-hidden="true">${active ? '✓' : '＋'}</span></button>`;
        }).join('')}</div><p class="topping-hint">複数選べます・もう一度タップで解除</p></section>`;
      }
      const button = (id, name, price, disabled, active) => `<button type="button" class="choice ${active ? 'sel on' : ''}" data-group="${Number(group.id)}" data-option="${id}" data-max="${Number(group.max_select || 1)}" aria-pressed="${active}" ${disabled ? 'disabled' : ''}>${escape(name)} <span>${escape(price)}</span>${disabled ? '（売り切れ）' : ''}</button>`;
      return `<section class="bowl-options ${ingredient ? 'ingredient-options' : ''}"><h3>${escape(group.name)}${group.required ? '（必須）' : ''}</h3>${ingredient ? button(0, '通常', 'この商品の標準量', false, chosen.length === 0) : ''}${(group.options || []).map(option => button(Number(option.id), option.name, priceLabel(option.price_delta, yen), option.available === false, chosen.includes(Number(option.id)))).join('')}</section>`;
    }).join('');
  }
  function toggle(groups, selected, groupId, optionId) {
    const group = groups.find(item => Number(item.id) === groupId);
    if (!group) return false;
    if (optionId === 0 && ingredients.has(group.name)) { selected[groupId] = []; return true; }
    const option = (group.options || []).find(item => Number(item.id) === optionId);
    if (!option || option.available === false) return false;
    const values = selected[groupId] || [];
    if (values.includes(optionId)) selected[groupId] = values.filter(id => id !== optionId);
    else if (Number(group.max_select || 1) === 1) selected[groupId] = [optionId];
    else if (values.length < Number(group.max_select || 1)) selected[groupId] = [...values, optionId];
    else return false;
    return true;
  }
  function validate(groups, selected) {
    for (const group of groups) {
      const ids = selected[group.id] || [];
      if (ids.length < Math.max(Number(group.min_select || 0), group.required ? 1 : 0)) return `${group.name}を選んでください`;
      if (ids.length > Number(group.max_select || 1)) return `${group.name}の選択数を確認してください`;
      if (ids.some(id => !(group.options || []).some(option => Number(option.id) === id && option.available !== false))) return `${group.name}に売り切れ・無効な選択肢があります`;
    }
    return '';
  }
  global.CustomerOptions = Object.freeze({ render, toggle, validate });
})(window);
