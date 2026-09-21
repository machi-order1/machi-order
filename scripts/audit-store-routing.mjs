import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('../', import.meta.url);
const files = (await readdir(root)).filter((name) => name.endsWith('.html'));
const publicStoreOnePages = new Set(['takeout.html']);
const failures = [];

for (const file of files) {
  const html = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
  if (!html.includes('store_id=1') || publicStoreOnePages.has(file)) continue;
  if (!html.includes('/machi-ui-config.js')) {
    failures.push(`${file}: 店舗コンテキスト未読込`);
  }
}

const config = await readFile(new URL('../machi-ui-config.js', import.meta.url), 'utf8');
const checks = [
  ['店舗IDを1・2だけに制限', config.includes('[1,2].includes(requestedStoreId)')],
  ['選択店舗を端末へ保存', config.includes("localStorage.setItem('machi_store_id',String(storeId))")],
  ['管理APIの固定店舗IDを選択店舗へ補正', config.includes("raw.includes('/functions/v1/')") && config.includes("store_id=2")],
  ['管理画面リンクへ店舗IDを引継ぎ', config.includes('propagateStoreLinks') && config.includes("url.searchParams.set('store_id',String(storeId))")],
  ['認証期限切れ時に1回だけ自動更新', config.includes('refreshPromise') && config.includes("response.status!==401") && config.includes("grant_type=refresh_token")],
  ['認証更新後も同じ店舗へ再送', config.includes('const retryInput=input instanceof Request?input.clone():input') && config.indexOf('const retryInput=') > config.indexOf("raw.replace(/([?&])store_id=1")],
];

for (const [name, ok] of checks) {
  if (!ok) failures.push(name);
}

if (failures.length) {
  console.error(failures.map((item) => `FAIL  ${item}`).join('\n'));
  process.exit(1);
}

console.log(`PASS  店舗ルーティング監査（${files.length}画面）`);
