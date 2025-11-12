/**
 * Logger.gs - Spreadsheetログ管理
 * 暗号化メールの送受信履歴を記録
 */

/**
 * ログSpreadsheetを初期化（初回のみ実行）
 */
function initLogSpreadsheet() {
  var props = PropertiesService.getScriptProperties();
  var existingId = props.getProperty('LOG_SPREADSHEET_ID');

  if (existingId) {
    Logger.log('既存のログSpreadsheet: ' + existingId);
    try {
      var ss = SpreadsheetApp.openById(existingId);
      Logger.log('既存のSpreadsheetを使用: ' + ss.getName());
      return existingId;
    } catch (e) {
      Logger.log('既存Spreadsheetにアクセスできません。新規作成します。');
    }
  }

  // 新規Spreadsheet作成
  var ss = SpreadsheetApp.create('EncryptedMail_Log_' + new Date().toISOString().split('T')[0]);
  var sheet = ss.getActiveSheet();
  sheet.setName('Logs');

  // ヘッダー行を設定
  var headers = [
    'Timestamp',
    'TrackingID',
    'OwnerEmail',
    'SourceMsgId',
    'SourceThreadId',
    'Files',
    'Passwords',
    'EncryptedLinks',
    'DraftId',
    'SentMsgId',
    'Recipients',
    'Whitelist',
    'ExpiryAt',
    'Status',
    'ErrorMessage'
  ];

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#4285F4').setFontColor('#FFFFFF');

  // 列幅を調整
  sheet.setColumnWidth(1, 180);  // Timestamp
  sheet.setColumnWidth(2, 140);  // TrackingID
  sheet.setColumnWidth(3, 200);  // OwnerEmail
  sheet.setColumnWidth(4, 180);  // SourceMsgId
  sheet.setColumnWidth(12, 180); // ExpiryAt
  sheet.setColumnWidth(13, 100); // Status

  // フリーズヘッダー
  sheet.setFrozenRows(1);

  // Script PropertiesにIDを保存
  var ssId = ss.getId();
  props.setProperty('LOG_SPREADSHEET_ID', ssId);

  Logger.log('✓ ログSpreadsheet作成完了: ' + ssId);
  Logger.log('URL: ' + ss.getUrl());

  return ssId;
}

/**
 * ログエントリーを追加
 * @param {Object} entry - ログデータ
 */
function addLogEntry(entry) {
  try {
    // PropertiesServiceから直接取得（SYSオブジェクトは初期化時の値のため更新されない）
    var ssId = PropertiesService.getScriptProperties().getProperty('LOG_SPREADSHEET_ID');
    if (!ssId) {
      ssId = initLogSpreadsheet();
    }

    var ss = SpreadsheetApp.openById(ssId);
    var sheet = ss.getSheetByName('Logs');

    if (!sheet) {
      throw new Error('Logsシートが見つかりません');
    }

    var row = [
      entry.timestamp || new Date().toISOString(),
      entry.trackingId || '',
      entry.ownerEmail || Session.getActiveUser().getEmail(),
      entry.sourceMsgId || '',
      entry.sourceThreadId || '',
      JSON.stringify(entry.files || []),
      JSON.stringify(entry.passwords || {}),
      JSON.stringify(entry.encryptedLinks || []),
      entry.draftId || '',
      entry.sentMsgId || '',
      JSON.stringify(entry.recipients || []),
      JSON.stringify(entry.whitelist || []),
      entry.expiryAt || '',
      entry.status || 'PROCESSING',
      entry.errorMessage || ''
    ];

    sheet.appendRow(row);

  } catch (e) {
    Logger.log('ログ記録エラー: ' + e.message);
    // ログ記録失敗は処理を止めない
  }
}

/**
 * ログエントリーを更新
 * @param {string} trackingId - 追跡ID
 * @param {Object} updates - 更新データ
 */
function updateLogEntry(trackingId, updates) {
  try {
    var ssId = PropertiesService.getScriptProperties().getProperty('LOG_SPREADSHEET_ID');
    if (!ssId) {
      Logger.log('ログSpreadsheetが初期化されていません');
      return;
    }

    var ss = SpreadsheetApp.openById(ssId);
    var sheet = ss.getSheetByName('Logs');

    if (!sheet) {
      throw new Error('Logsシートが見つかりません');
    }

    var data = sheet.getDataRange().getValues();

    // TrackingIDで検索（列2: TrackingID）
    for (var i = 1; i < data.length; i++) {
      if (data[i][1] === trackingId) {
        // 更新 (列番号は1-indexed)
        // 9: DraftId, 10: SentMsgId, 11: Recipients, 12: Whitelist, 13: Status, 14: ErrorMessage
        if (updates.draftId !== undefined) sheet.getRange(i + 1, 9).setValue(updates.draftId);
        if (updates.sentMsgId !== undefined) sheet.getRange(i + 1, 10).setValue(updates.sentMsgId);
        if (updates.recipients !== undefined) sheet.getRange(i + 1, 11).setValue(JSON.stringify(updates.recipients));
        if (updates.whitelist !== undefined) sheet.getRange(i + 1, 12).setValue(JSON.stringify(updates.whitelist));
        if (updates.status !== undefined) sheet.getRange(i + 1, 14).setValue(updates.status);
        if (updates.errorMessage !== undefined) sheet.getRange(i + 1, 15).setValue(updates.errorMessage);

        // 追加フィールド: ExpiryAt (13列目)
        if (updates.expiryAt !== undefined) sheet.getRange(i + 1, 13).setValue(updates.expiryAt);

        // 補足情報をExpiryAt列の後に追加する場合の拡張
        // passwordRequested, passwordRequestedAt, passwordRequestEmail, downloadedAt, downloadedBy等は
        // ErrorMessage列を使うか、新しい列を追加する必要があります

        Logger.log('ログ更新: ' + trackingId + ' → ' + (updates.status || 'updated'));
        return;
      }
    }

    Logger.log('ログエントリーが見つかりません: ' + trackingId);

  } catch (e) {
    Logger.log('ログ更新エラー: ' + e.message);
  }
}

/**
 * 追跡IDでログエントリーを取得
 * @param {string} trackingId - 追跡ID
 * @return {Object|null} ログデータ
 */
function getLogEntry(trackingId) {
  try {
    var ssId = PropertiesService.getScriptProperties().getProperty('LOG_SPREADSHEET_ID');
    if (!ssId) {
      return null;
    }

    var ss = SpreadsheetApp.openById(ssId);
    var sheet = ss.getSheetByName('Logs');

    if (!sheet) {
      return null;
    }

    var data = sheet.getDataRange().getValues();

    // TrackingIDで検索
    for (var i = 1; i < data.length; i++) {
      if (data[i][1] === trackingId) {
        return {
          timestamp: data[i][0],
          trackingId: data[i][1],
          ownerEmail: data[i][2],
          sourceMsgId: data[i][3],
          sourceThreadId: data[i][4],
          files: JSON.parse(data[i][5] || '[]'),
          passwords: JSON.parse(data[i][6] || '{}'),
          encryptedLinks: JSON.parse(data[i][7] || '[]'),
          draftId: data[i][8],
          sentMsgId: data[i][9],
          recipients: JSON.parse(data[i][10] || '[]'),
          whitelist: JSON.parse(data[i][11] || '[]'),
          expiryAt: data[i][12],
          status: data[i][13],
          errorMessage: data[i][14]
        };
      }
    }

    return null;

  } catch (e) {
    Logger.log('ログ取得エラー: ' + e.message);
    return null;
  }
}

/**
 * 期限切れのログエントリーを取得
 * @return {Array} 期限切れエントリーのリスト
 */
function getExpiredLogEntries() {
  try {
    var ssId = PropertiesService.getScriptProperties().getProperty('LOG_SPREADSHEET_ID');
    if (!ssId) {
      return [];
    }

    var ss = SpreadsheetApp.openById(ssId);
    var sheet = ss.getSheetByName('Logs');

    if (!sheet) {
      return [];
    }

    var data = sheet.getDataRange().getValues();
    var now = new Date();
    var expired = [];

    for (var i = 1; i < data.length; i++) {
      var expiryAt = data[i][12];
      var status = data[i][13];

      if (expiryAt && status !== 'DELETED' && status !== 'EXPIRED') {
        var expiryDate = new Date(expiryAt);
        if (expiryDate < now) {
          expired.push({
            rowIndex: i + 1,
            trackingId: data[i][1],
            ownerEmail: data[i][2],
            files: JSON.parse(data[i][5] || '[]'),
            encryptedLinks: JSON.parse(data[i][7] || '[]'),
            expiryAt: expiryAt,
            status: status
          });
        }
      }
    }

    return expired;

  } catch (e) {
    Logger.log('期限切れログ取得エラー: ' + e.message);
    return [];
  }
}

/**
 * ログのテスト
 */
function testLogger() {
  Logger.log('=== Logger テスト ===');

  // 初期化
  var ssId = initLogSpreadsheet();
  Logger.log('SpreadsheetID: ' + ssId);

  // テストエントリーを追加
  var trackingId = generateTrackingId();
  addLogEntry({
    trackingId: trackingId,
    ownerEmail: 'test@example.com',
    sourceMsgId: 'msg_12345',
    sourceThreadId: 'thread_67890',
    files: [{ name: 'test.pdf', size: 1024 }],
    passwords: { 'test.pdf': 'Abc123!@#XyzAbcDef1234567' },
    encryptedLinks: ['https://drive.google.com/file/d/xxxxx'],
    status: 'DRAFT_CREATED',
    expiryAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
  });

  Logger.log('エントリー追加: ' + trackingId);

  // 取得テスト
  var entry = getLogEntry(trackingId);
  Logger.log('取得結果: ' + JSON.stringify(entry, null, 2));

  // 更新テスト
  updateLogEntry(trackingId, {
    status: 'PASSWORD_SENT',
    sentMsgId: 'sent_99999'
  });

  Logger.log('✓ Logger テスト完了');
}
