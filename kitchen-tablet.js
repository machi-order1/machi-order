/* Visual enhancement only: order transitions still use kitchen-api. */
(() => {
  const storeName = STORE_CODE === 'shirakibaru' ? '白木原店' : '長浜店';
  document.querySelector('.head h1').textContent = storeName + ' 厨房';
  document.title = storeName + ' 厨房｜MACHI ORDER';
  if (STORE_CODE === 'shirakibaru') {
    document.querySelector('link[rel="manifest"]').href = '/kitchen-shirakibaru.webmanifest';
    document.querySelector('.mo-appnav a.active').href = '/kitchen.html?store=shirakibaru';
    const test = document.querySelector('.test-actions a[href="/takeout.html"]');
    if (test) test.remove(); // Do not send a Shirakibaru test to Nagahama.
  }
  const summary = document.createElement('div');
  summary.className = 'kitchen-summary';
  summary.setAttribute('aria-live', 'polite');
  document.querySelector('.wrap').prepend(summary);
  const oldRender = render;
  render = function () {
    oldRender();
    const newly = orders.filter(o => o.status === 'new').length;
    const cooking = orders.filter(o => o.status === 'cooking').length;
    summary.innerHTML = `<strong>${storeName}・対応中</strong><span class="summary-chip ${newly ? 'alert' : ''}">● 新規 ${newly}件</span><span class="summary-chip ${cooking ? 'warn' : ''}">● 調理中 ${cooking}件</span><span class="summary-note">提供後と会計は会計画面で確認</span>`;
    const visible = orders.filter(o => filter === 'all' || o.status === filter);
    document.querySelectorAll('.card').forEach((card, index) => {
      const order = visible[index];
      if (!order) return;
      card.classList.add(order.status);
      const ageNode = card.querySelector('.age');
      if (ageNode) ageNode.setAttribute('aria-label', '注文から ' + age(order.ordered_at));
    });
  };
  render();
})();
