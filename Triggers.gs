/**
 * Triggers.gs - トリガー管理
 * 自動実行トリガーのセットアップと管理
 */

/**
 * トリガーを一括セットアップ
 * 初回実行時に1度だけ実行する
 */
function setupAllTriggers() {
  Logger.log('=== トリガーセットアップ開始 ===');

  // 既存のトリガーを削除
  deleteAllTriggers();

  // 1. メール処理トリガー（1分ごと）
  ScriptApp.newTrigger('processIncomingMails')
    .timeBased()
    .everyMinutes(1)
    .create();
  Logger.log('✓ メール処理トリガー作成（1分ごと）');

  // 2. ホワイトリスト登録トリガー（1分ごと）
  ScriptApp.newTrigger('processSentMailsForPassword')
    .timeBased()
    .everyMinutes(1)
    .create();
  Logger.log('✓ ホワイトリスト登録トリガー作成（1分ごと）');

  // 3. 期限切れファイル削除トリガー（毎日午前2時）
  ScriptApp.newTrigger('sweepExpiredFiles')
    .timeBased()
    .atHour(2)
    .everyDays(1)
    .create();
  Logger.log('✓ 期限切れファイル削除トリガー作成（毎日2時）');

  Logger.log('=== トリガーセットアップ完了 ===');

  // トリガー一覧を表示
  listAllTriggers();
}

/**
 * 全トリガーを削除
 */
function deleteAllTriggers() {
  var triggers = ScriptApp.getProjectTriggers();

  Logger.log('既存トリガー数: ' + triggers.length);

  for (var i = 0; i < triggers.length; i++) {
    ScriptApp.deleteTrigger(triggers[i]);
  }

  Logger.log('✓ 全トリガー削除完了');
}

/**
 * トリガー一覧を表示
 */
function listAllTriggers() {
  var triggers = ScriptApp.getProjectTriggers();

  Logger.log('=== 現在のトリガー一覧 ===');
  Logger.log('トリガー数: ' + triggers.length);

  for (var i = 0; i < triggers.length; i++) {
    var trigger = triggers[i];
    var handlerFunction = trigger.getHandlerFunction();
    var eventType = trigger.getEventType();

    Logger.log((i + 1) + ': ' + handlerFunction + ' (' + eventType + ')');

    // 時間ベーストリガーの詳細
    if (eventType === ScriptApp.EventType.CLOCK) {
      // 詳細情報は取得できないため、関数名のみ表示
      Logger.log('   タイプ: 時間ベース');
    }
  }

  Logger.log('=== 一覧表示完了 ===');
}

/**
 * カスタマイズ版: メール処理トリガーのみ作成（テスト用）
 */
function setupMailProcessorTriggerOnly() {
  Logger.log('=== メール処理トリガーのみセットアップ ===');

  // 既存の同名トリガーを削除
  deleteTriggersForFunction('processIncomingMails');

  // トリガー作成（1分ごと）
  ScriptApp.newTrigger('processIncomingMails')
    .timeBased()
    .everyMinutes(1)
    .create();

  Logger.log('✓ メール処理トリガー作成完了');
}

/**
 * カスタマイズ版: ホワイトリスト登録トリガーのみ作成（テスト用）
 */
function setupPasswordNotifierTriggerOnly() {
  Logger.log('=== ホワイトリスト登録トリガーのみセットアップ ===');

  // 既存の同名トリガーを削除
  deleteTriggersForFunction('processSentMailsForPassword');

  // トリガー作成（1分ごと）
  ScriptApp.newTrigger('processSentMailsForPassword')
    .timeBased()
    .everyMinutes(1)
    .create();

  Logger.log('✓ ホワイトリスト登録トリガー作成完了');
}

/**
 * カスタマイズ版: 削除トリガーのみ作成（テスト用）
 */
function setupSweeperTriggerOnly() {
  Logger.log('=== 削除トリガーのみセットアップ ===');

  // 既存の同名トリガーを削除
  deleteTriggersForFunction('sweepExpiredFiles');

  // トリガー作成
  ScriptApp.newTrigger('sweepExpiredFiles')
    .timeBased()
    .atHour(2)
    .everyDays(1)
    .create();

  Logger.log('✓ 削除トリガー作成完了');
}

/**
 * 特定の関数のトリガーを削除
 */
function deleteTriggersForFunction(functionName) {
  var triggers = ScriptApp.getProjectTriggers();
  var count = 0;

  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === functionName) {
      ScriptApp.deleteTrigger(triggers[i]);
      count++;
    }
  }

  Logger.log('✓ ' + functionName + ' のトリガー削除: ' + count + ' 件');
}

/**
 * トリガーエラーのモニタリング（オプション）
 * トリガー実行時のエラーを記録する
 */
function onTriggerError(e) {
  try {
    Logger.log('=== トリガーエラー ===');
    Logger.log('エラー: ' + e.message);
    Logger.log('スタック: ' + e.stack);

    // エラー通知メールを送信（オプション）
    var userEmail = Session.getActiveUser().getEmail();

    GmailApp.sendEmail(
      userEmail,
      '【NHP SecureLocker】トリガーエラー通知',
      'トリガー実行中にエラーが発生しました。\n\n' +
      'エラー: ' + e.message + '\n' +
      'スタック: ' + e.stack + '\n\n' +
      '詳細はスクリプトのログを確認してください。'
    );

  } catch (err) {
    Logger.log('エラー通知の送信に失敗: ' + err.message);
  }
}
