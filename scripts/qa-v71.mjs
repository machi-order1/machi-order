import { readFile } from 'node:fs/promises';

const checks = [];
const source = async (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
const expect = (name, ok) => checks.push({ name, ok: Boolean(ok) });

const [cashier, cashierApi, paymentUndo, reset, login, opening, operationLog, operationsApi, worker, menu, kitchen, productAdmin, menuAdminApi, menuApi, kitchenApi, orderingGuard, timeClock, myShifts, workforceApi, uiConfig, takeout, takeoutApi] = await Promise.all([
  source('cashier.html'),
  source('supabase/functions/cashier-api/index.ts'),
  source('supabase/migrations/20260921_cashier_payment_undo.sql'),
  source('reset-password.html'),
  source('login.html'),
  source('opening-check.html'),
  source('operation-log.html'),
  source('supabase/functions/operations-api/index.ts'),
  source('sw.js'),
  source('index.html'),
  source('kitchen.html'),
  source('product-admin.html'),
  source('supabase/functions/menu-admin-api/index.ts'),
  source('supabase/functions/menu-api/index.ts'),
  source('supabase/functions/kitchen-api/index.ts'),
  source('supabase/migrations/20260921_ordering_pause_guard.sql'),
  source('time-clock.html'),
  source('my-shifts.html'),
  source('supabase/functions/workforce-api/index.ts'),
  source('machi-ui-config.js'),
  source('takeout.html'),
  source('supabase/functions/takeout-api/index.ts'),
]);

expect('現金受取を明示してから会計完了', cashier.includes('現金を受け取りました'));
expect('PayPay入金確認を明示してから会計完了', cashier.includes('PayPay側で') && cashier.includes('入金済みを確認'));
expect('会計完了メッセージを表示', cashier.includes('showToast') && cashier.includes('会計を完了しました'));
expect('会計APIは認証トークン必須', cashier.includes("Authorization:'Bearer '+await token()"));
expect('本日の会計履歴を検索・支払方法で絞込', cashier.includes('history-search') && cashier.includes('payment-filter') && cashierApi.includes("mode === 'history'"));
expect('会計完了は10秒表示から取り消せる', cashier.includes('toast-action') && cashier.includes("action:'undo_payment'"));
expect('会計取消は5分以内だけ許可', paymentUndo.includes("interval '5 minutes'") && paymentUndo.includes("'payment_reverted'"));
expect('PayPay取消は自動返金でないと明示', cashier.includes('PayPayの返金は自動では行われません'));
expect('再設定は8文字以上かつ2回一致', reset.includes('password.length<8') && reset.includes('password!==confirm'));
expect('再設定リンクを画面更新後も保持', reset.includes('machi_recovery_access_token'));
expect('新パスワードはSupabase Authへ更新', reset.includes("'/auth/v1/user'") && reset.includes("method:'PUT'"));
expect('再設定メールの戻り先を専用画面に指定', login.includes("'/reset-password.html'"));
expect('営業前チェックで席QR14件を確認', opening.includes('active_table_count===14'));
expect('営業前チェックで公開商品40件を確認', opening.includes('customer_visible_product_count===40'));
expect('営業前チェックで厨房・会計APIを確認', opening.includes('k.ok&&c.ok'));
expect('営業前チェックで注文受付ONを確認', opening.includes('注文受付スイッチ') && opening.includes('ordering_enabled!==false'));
expect('営業前チェック完了を担当者付きで記録', opening.includes('record_opening_check') && menuAdminApi.includes('opening_check_completed'));
expect('操作履歴は店長権限だけ閲覧可能', operationLog.includes('operations-api') && operationsApi.includes('managerRoles'));
expect('商品・受付・会計の重要操作を監査記録', menuAdminApi.includes('sale_status_changed') && menuAdminApi.includes('ordering_changed') && cashierApi.includes('payment_completed') && cashierApi.includes('payment_reverted'));
expect('売切・停止を1タップで絞込', productAdmin.includes('quickfilters') && productAdmin.includes('data-status="sold_out"'));
expect('更新キャッシュ番号', worker.includes("machi-order-v71-18"));
expect('営業時間外・受付停止を注文前に表示', menu.includes('orderingMessage') && menu.includes('現在は注文できません'));
expect('店長が注文受付を一時停止・再開できる', productAdmin.includes('set_ordering_enabled') && productAdmin.includes('注文受付を停止中'));
expect('注文受付停止をAPI側でも返す', menuApi.includes('注文受付を一時停止しています'));
expect('注文受付停止をDB側でも防ぐ', orderingGuard.includes('ordering_enabled') && orderingGuard.includes('注文受付を停止しています'));
expect('厨房の提供完了を10秒間取り消せる', kitchen.includes('undo-button') && kitchen.includes('undo:true'));
expect('厨房APIの取り消しは提供後5分以内', kitchenApi.includes("order.status === 'served'") && kitchenApi.includes('5 * 60_000'));
expect('厨房オフライン表示と復帰時再接続', kitchen.includes("addEventListener('offline'") && kitchen.includes("addEventListener('online'"));
expect('厨房通知設定を保持して新規注文時に振動', kitchen.includes('machi_kitchen_sound') && kitchen.includes('navigator.vibrate'));
expect('勤怠打刻は保存済みログインを使用', timeClock.includes('machi_access_token') && !timeClock.includes('ログイントークン'));
expect('出勤・休憩・退勤を状態別に操作', timeClock.includes("act('clock_in')") && timeClock.includes("act('break_start')") && timeClock.includes("act('break_end')") && timeClock.includes("act('clock_out')"));
expect('勤怠APIは二重打刻と休憩中退勤を防止', workforceApi.includes('すでに出勤中です') && workforceApi.includes('休憩終了を押してから退勤してください'));
expect('シフト日付検証は数字を正しく受け付ける', workforceApi.includes('/^\\d{4}-\\d{2}-\\d{2}$/') && !workforceApi.includes('/^\\\\d{4}'));
expect('マイシフトは手入力トークンを廃止', myShifts.includes('machi_access_token') && !myShifts.includes('ログイントークン'));
expect('スタッフ画面から勤怠打刻へ移動', uiConfig.includes("link.href='/time-clock.html'"));
expect('勤怠・シフトをオフラインキャッシュ対象に追加', worker.includes("machi-order-v71-18") && worker.includes("'/time-clock.html'") && worker.includes("'/my-shifts.html'"));
expect('公開テイクアウト注文画面をキャッシュ対象に追加', worker.includes("'/takeout.html'"));
expect('テイクアウト再送は同じ注文IDを再利用', takeout.includes('machi_takeout_pending') && takeout.includes('pending.signature!==signature'));
expect('受取時刻は店舗設定の最短・最長を反映', takeout.includes('min_lead_minutes') && takeout.includes('max_advance_minutes') && takeout.includes('min="${min}"') && takeout.includes('max="${max}"'));
expect('厨房にテイクアウト受取情報を表示', kitchenApi.includes('takeout_order_details(customer_name,phone,pickup_at,pickup_status)') && kitchen.includes('takeout-meta'));
expect('会計にテイクアウト受取情報を表示・検索', cashierApi.includes('takeout_order_details(customer_name,phone,pickup_at,pickup_status)') && cashier.includes('takeoutMeta') && cashier.includes('info?.phone'));
expect('テイクアウトAPIは注文IDで冪等処理', takeoutApi.includes('requestId') && takeoutApi.includes('place_takeout_order_idempotent'));

for (const check of checks) console.log(`${check.ok ? 'PASS' : 'FAIL'}  ${check.name}`);
if (checks.some((check) => !check.ok)) process.exitCode = 1;
else console.log(`\n${checks.length}/${checks.length} checks passed`);
