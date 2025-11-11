/**
 * SystemControl.gs - システム全体の起動・停止・診断
 */

/**
 * 【START】SecureLockerを一括セットアップして起動
 * この関数を1回実行するだけでシステム全体が起動します
 */
function startSecureLocker() {
  Logger.log('========================================');
  Logger.log('    NHP SecureLocker 起動中...        ');
  Logger.log('========================================\n');

  var results = [];

  try {
    // ステップ1: Bootstrap（フォルダ作成・HMAC生成）
    Logger.log('[1/5] Bootstrap実行中...');
    try {
      bootstrapSecureLocker();
      results.push('✓ Bootstrap完了');
      Logger.log('✓ Bootstrap完了\n');
    } catch (e) {
      if (e.message.indexOf('既に設定済み') > -1) {
        results.push('✓ Bootstrap（スキップ：既存設定を使用）');
        Logger.log('✓ Bootstrap（スキップ：既存設定を使用）\n');
      } else {
        throw e;
      }
    }

    // ステップ2: ログスプレッドシート作成
    Logger.log('[2/5] ログスプレッドシート確認中...');
    var props = PropertiesService.getScriptProperties();
    if (!props.getProperty('LOG_SPREADSHEET_ID')) {
      initLogSpreadsheet();
      results.push('✓ ログスプレッドシート作成完了');
      Logger.log('✓ ログスプレッドシート作成完了\n');
    } else {
      results.push('✓ ログスプレッドシート（既存）');
      Logger.log('✓ ログスプレッドシート（既存）\n');
    }

    // ステップ3: トリガー設定
    Logger.log('[3/5] トリガー設定中...');
    setupAllTriggers();
    results.push('✓ トリガー設定完了');
    Logger.log('✓ トリガー設定完了\n');

    // ステップ4: 設定検証
    Logger.log('[4/5] 設定検証中...');
    validateConfig();
    results.push('✓ 設定検証完了');
    Logger.log('✓ 設定検証完了\n');

    // ステップ5: 暗号化セルフテスト
    Logger.log('[5/5] 暗号化エンジンテスト中...');
    selfTest_EncryptSmallBlob();
    results.push('✓ 暗号化テスト成功');
    Logger.log('✓ 暗号化テスト成功\n');

    // 完了メッセージ
    Logger.log('========================================');
    Logger.log('    🎉 起動完了！                     ');
    Logger.log('========================================\n');
    Logger.log('システムは正常に起動しました。\n');
    Logger.log('次の手順：');
    Logger.log('1. ' + SYS.TRIGGER_EMAIL + ' 宛にテストメールを送信');
    Logger.log('2. 5分以内に自動処理が開始されます');
    Logger.log('3. 問題がある場合は diagnoseSecureLocker() を実行\n');

    for (var i = 0; i < results.length; i++) {
      Logger.log(results[i]);
    }

    return { success: true, message: '起動完了' };

  } catch (e) {
    Logger.log('\n❌ エラー発生: ' + e.message);
    Logger.log('\n詳細: ' + e.stack);
    throw new Error('起動失敗: ' + e.message);
  }
}

/**
 * 【STOP】SecureLockerを完全停止
 * トリガーを全て削除してシステムを停止します
 */
function stopSecureLocker() {
  Logger.log('========================================');
  Logger.log('    NHP SecureLocker 停止中...        ');
  Logger.log('========================================\n');

  try {
    // 全トリガー削除
    deleteAllTriggers();

    Logger.log('========================================');
    Logger.log('    ⏸️  停止完了                      ');
    Logger.log('========================================\n');
    Logger.log('全てのトリガーが削除されました。');
    Logger.log('メールは自動処理されなくなります。\n');
    Logger.log('再起動するには startSecureLocker() を実行してください。');

    return { success: true, message: '停止完了' };

  } catch (e) {
    Logger.log('\n❌ エラー発生: ' + e.message);
    throw new Error('停止失敗: ' + e.message);
  }
}

/**
 * 【STATUS】現在の状態を確認
 */
function statusSecureLocker() {
  Logger.log('========================================');
  Logger.log('    NHP SecureLocker ステータス       ');
  Logger.log('========================================\n');

  var props = PropertiesService.getScriptProperties();
  var status = {
    configured: true,
    running: false,
    issues: []
  };

  // 設定チェック
  Logger.log('【設定状態】');
  var sharedDriveId = props.getProperty('SHARED_DRIVE_ID');
  var encryptedFolderId = props.getProperty('FOLDER_ENCRYPTED_ID');
  var logsFolderId = props.getProperty('FOLDER_LOGS_ID');
  var hmacSecret = props.getProperty('SECRET_HMAC');
  var logSpreadsheetId = props.getProperty('LOG_SPREADSHEET_ID');

  Logger.log((sharedDriveId ? '✓' : '✗') + ' 共有ドライブID: ' + (sharedDriveId || '未設定'));
  Logger.log((encryptedFolderId ? '✓' : '✗') + ' Encryptedフォルダ: ' + (encryptedFolderId || '未設定'));
  Logger.log((logsFolderId ? '✓' : '✗') + ' Logsフォルダ: ' + (logsFolderId || '未設定'));
  Logger.log((hmacSecret ? '✓' : '✗') + ' SECRET_HMAC: ' + (hmacSecret ? '設定済み' : '未設定'));
  Logger.log((logSpreadsheetId ? '✓' : '✗') + ' ログスプレッドシート: ' + (logSpreadsheetId || '未設定'));

  if (!sharedDriveId || !encryptedFolderId || !logsFolderId || !hmacSecret) {
    status.configured = false;
    status.issues.push('設定が不完全です。startSecureLocker() を実行してください。');
  }

  // トリガーチェック
  Logger.log('\n【トリガー状態】');
  var triggers = ScriptApp.getProjectTriggers();
  var hasMail = false;
  var hasPassword = false;
  var hasSweep = false;

  for (var i = 0; i < triggers.length; i++) {
    var t = triggers[i];
    var funcName = t.getHandlerFunction();
    Logger.log('✓ ' + funcName);

    if (funcName === 'processIncomingMails') hasMail = true;
    if (funcName === 'processSentMailsForPassword') hasPassword = true;
    if (funcName === 'sweepExpiredFiles') hasSweep = true;
  }

  if (triggers.length === 0) {
    Logger.log('✗ トリガーなし（停止中）');
    status.issues.push('トリガーが設定されていません。startSecureLocker() を実行してください。');
  } else {
    status.running = true;
    if (!hasMail) status.issues.push('メール処理トリガーが欠落しています');
    if (!hasPassword) status.issues.push('パスワード送信トリガーが欠落しています');
    if (!hasSweep) status.issues.push('ファイル削除トリガーが欠落しています');
  }

  // 最近のエラーチェック
  Logger.log('\n【最近の実行履歴】');
  try {
    var recentLogs = getRecentLogs(5);
    if (recentLogs && recentLogs.length > 0) {
      for (var i = 0; i < recentLogs.length; i++) {
        var log = recentLogs[i];
        Logger.log('• ' + log.timestamp + ' - ' + log.trackingId + ' - ' + log.status);
      }
    } else {
      Logger.log('（まだ処理履歴がありません）');
    }
  } catch (e) {
    Logger.log('✗ ログ取得エラー: ' + e.message);
  }

  // 総合判定
  Logger.log('\n========================================');
  if (status.configured && status.running && status.issues.length === 0) {
    Logger.log('    ✅ 正常稼働中                     ');
  } else if (status.issues.length > 0) {
    Logger.log('    ⚠️  問題あり                      ');
  } else {
    Logger.log('    ⏸️  停止中                        ');
  }
  Logger.log('========================================\n');

  if (status.issues.length > 0) {
    Logger.log('【問題点】');
    for (var i = 0; i < status.issues.length; i++) {
      Logger.log('• ' + status.issues[i]);
    }
  }

  return status;
}

/**
 * 【DIAGNOSE】問題診断
 * メールが処理されない原因を調査します
 */
function diagnoseSecureLocker() {
  Logger.log('========================================');
  Logger.log('    診断開始                          ');
  Logger.log('========================================\n');

  var issues = [];

  // 1. 設定チェック
  Logger.log('[1/6] 設定確認中...');
  try {
    validateConfig();
    Logger.log('✓ 設定OK\n');
  } catch (e) {
    issues.push('設定エラー: ' + e.message);
    Logger.log('✗ 設定エラー: ' + e.message + '\n');
  }

  // 2. トリガーチェック
  Logger.log('[2/6] トリガー確認中...');
  var triggers = ScriptApp.getProjectTriggers();
  if (triggers.length === 0) {
    issues.push('トリガーが設定されていません');
    Logger.log('✗ トリガーなし\n');
  } else {
    Logger.log('✓ トリガー数: ' + triggers.length + '\n');
  }

  // 3. メール検索テスト
  Logger.log('[3/6] メール検索テスト中...');
  try {
    var searchQuery = 'to:' + SYS.TRIGGER_EMAIL + ' -label:' + SYS.LABELS.PROCESSED + ' newer_than:7d';
    Logger.log('検索クエリ: ' + searchQuery);
    var threads = GmailApp.search(searchQuery, 0, 10);
    Logger.log('✓ 検出メール数: ' + threads.length);

    if (threads.length > 0) {
      Logger.log('\n未処理メール:');
      for (var i = 0; i < Math.min(threads.length, 3); i++) {
        var t = threads[i];
        var msgs = t.getMessages();
        Logger.log('  • 件名: ' + t.getFirstMessageSubject());
        Logger.log('    日時: ' + msgs[0].getDate());
        Logger.log('    ID: ' + msgs[0].getId());
      }
    } else {
      Logger.log('（該当メールなし）');
      issues.push('処理対象のメールが見つかりません。' + SYS.TRIGGER_EMAIL + ' 宛にメールを送信してください。');
    }
    Logger.log('');
  } catch (e) {
    issues.push('メール検索エラー: ' + e.message);
    Logger.log('✗ メール検索エラー: ' + e.message + '\n');
  }

  // 4. ドライブアクセステスト
  Logger.log('[4/6] ドライブアクセステスト中...');
  try {
    var props = PropertiesService.getScriptProperties();
    var encryptedFolderId = props.getProperty('FOLDER_ENCRYPTED_ID');
    var folder = DriveApp.getFolderById(encryptedFolderId);
    Logger.log('✓ Encryptedフォルダ: ' + folder.getName());
    Logger.log('  ファイル数: ' + folder.getFiles().hasNext() + '\n');
  } catch (e) {
    issues.push('ドライブアクセスエラー: ' + e.message);
    Logger.log('✗ ドライブアクセスエラー: ' + e.message + '\n');
  }

  // 5. Advanced Services チェック
  Logger.log('[5/6] Advanced Services確認中...');
  try {
    Gmail.Users.Messages.list('me', { maxResults: 1 });
    Logger.log('✓ Gmail API OK');
  } catch (e) {
    issues.push('Gmail API未有効: GASエディタでGmail APIを有効化してください');
    Logger.log('✗ Gmail API未有効\n');
  }

  try {
    var props = PropertiesService.getScriptProperties();
    var sharedDriveId = props.getProperty('SHARED_DRIVE_ID');
    Drive.Files.list({ corpora: 'drive', driveId: sharedDriveId, includeItemsFromAllDrives: true, supportsAllDrives: true, maxResults: 1 });
    Logger.log('✓ Drive API OK\n');
  } catch (e) {
    issues.push('Drive API未有効: GASエディタでDrive APIを有効化してください');
    Logger.log('✗ Drive API未有効\n');
  }

  // 6. 手動処理テスト
  Logger.log('[6/6] 手動処理テスト...');
  Logger.log('processIncomingMails() を手動実行してみます...\n');
  try {
    processIncomingMails();
    Logger.log('✓ 手動実行成功\n');
  } catch (e) {
    issues.push('手動実行エラー: ' + e.message);
    Logger.log('✗ 手動実行エラー: ' + e.message + '\n');
  }

  // 診断結果
  Logger.log('========================================');
  if (issues.length === 0) {
    Logger.log('    ✅ 問題なし                       ');
    Logger.log('========================================\n');
    Logger.log('システムは正常です。');
    Logger.log('メールが処理されない場合は、5分待ってから再確認してください。');
  } else {
    Logger.log('    ⚠️  ' + issues.length + ' 個の問題を検出        ');
    Logger.log('========================================\n');
    for (var i = 0; i < issues.length; i++) {
      Logger.log((i + 1) + '. ' + issues[i]);
    }
  }

  return { issueCount: issues.length, issues: issues };
}

/**
 * 最近のログエントリーを取得（診断用）
 */
function getRecentLogs(limit) {
  try {
    var props = PropertiesService.getScriptProperties();
    var ssId = props.getProperty('LOG_SPREADSHEET_ID');
    if (!ssId) return [];

    var ss = SpreadsheetApp.openById(ssId);
    var sheet = ss.getSheetByName('Logs') || ss.getSheets()[0];
    var lastRow = sheet.getLastRow();

    if (lastRow <= 1) return [];

    var startRow = Math.max(2, lastRow - limit + 1);
    var numRows = lastRow - startRow + 1;
    var data = sheet.getRange(startRow, 1, numRows, 10).getValues();

    var logs = [];
    for (var i = data.length - 1; i >= 0; i--) {
      logs.push({
        timestamp: data[i][0],
        trackingId: data[i][1],
        status: data[i][6]
      });
    }

    return logs;
  } catch (e) {
    return [];
  }
}
function checkLogSpreadsheet() {
  var props = PropertiesService.getScriptProperties();
  var ssId = props.getProperty('LOG_SPREADSHEET_ID');
  
  if (!ssId) {
    Logger.log('ログスプレッドシートは未作成です。');
    Logger.log('→ initLogSpreadsheet() を実行してください');
    return;
  }
  
  var ss = SpreadsheetApp.openById(ssId);
  var sheet = ss.getSheetByName('Logs');
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  
  Logger.log('現在の列数: ' + headers.length);
  Logger.log('現在の列名: ' + headers.join(', '));
  
  // Whitelist列があるかチェック
  var hasWhitelist = false;
  for (var i = 0; i < headers.length; i++) {
    if (headers[i] === 'Whitelist') {
      hasWhitelist = true;
      break;
    }
  }
  
  if (hasWhitelist) {
    Logger.log('✓ Whitelist列は既に存在します（更新不要）');
  } else {
    Logger.log('✗ Whitelist列が存在しません（更新が必要）');
    Logger.log('→ updateLogSpreadsheetColumns() を実行してください');
  }
  
  Logger.log('\nスプレッドシートURL: ' + ss.getUrl());
}
function updateLogSpreadsheetColumns() {
  var props = PropertiesService.getScriptProperties();
  var ssId = props.getProperty('LOG_SPREADSHEET_ID');
  
  if (!ssId) {
    Logger.log('エラー: ログスプレッドシートが見つかりません');
    return;
  }
  
  var ss = SpreadsheetApp.openById(ssId);
  var sheet = ss.getSheetByName('Logs');
  
  // Recipients列の位置を確認（11列目のはず）
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var recipientsIndex = -1;
  
  for (var i = 0; i < headers.length; i++) {
    if (headers[i] === 'Recipients') {
      recipientsIndex = i + 1;  // 1-indexed
      break;
    }
  }
  
  if (recipientsIndex === -1) {
    Logger.log('エラー: Recipients列が見つかりません');
    return;
  }
  
  Logger.log('Recipients列の位置: ' + recipientsIndex + '列目');
  
  // Recipients列の次に新しい列を挿入
  sheet.insertColumnAfter(recipientsIndex);
  
  // 新しい列のヘッダーを設定
  sheet.getRange(1, recipientsIndex + 1)
    .setValue('Whitelist')
    .setFontWeight('bold')
    .setBackground('#4285F4')
    .setFontColor('#FFFFFF');
  
  Logger.log('✓ Whitelist列を追加しました（' + (recipientsIndex + 1) + '列目）');
  Logger.log('✓ 更新完了');
  Logger.log('\nスプレッドシートURL: ' + ss.getUrl());
}
