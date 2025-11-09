/**
 * LifecycleManager.gs - ライフサイクル管理
 * 期限切れファイルの自動削除
 */

/**
 * メイン処理: 期限切れファイルを削除
 * トリガーから日次で実行される
 */
function sweepExpiredFiles() {
  try {
    Logger.log('=== 期限切れファイル削除開始 ===');

    // ログから期限切れエントリーを取得
    var expiredEntries = getExpiredLogEntries();

    Logger.log('期限切れエントリー: ' + expiredEntries.length + ' 件');

    var deletedCount = 0;
    var errors = [];

    for (var i = 0; i < expiredEntries.length; i++) {
      var entry = expiredEntries[i];

      try {
        Logger.log('処理中: ' + entry.trackingId + ' (期限: ' + entry.expiryAt + ')');

        // 暗号化ファイルのリンクからIDを抽出して削除
        for (var j = 0; j < entry.encryptedLinks.length; j++) {
          var link = entry.encryptedLinks[j];
          var fileId = extractFileIdFromLink(link);

          if (fileId) {
            deleteFile(fileId);
            deletedCount++;
          }
        }

        // ログを更新
        updateLogEntryByRow(entry.rowIndex, {
          status: 'DELETED'
        });

        Logger.log('  ✓ 削除完了: ' + entry.trackingId);

      } catch (e) {
        Logger.log('  ✗ 削除エラー: ' + entry.trackingId + ' - ' + e.message);
        errors.push({
          trackingId: entry.trackingId,
          error: e.message
        });

        // エラーをログに記録
        updateLogEntryByRow(entry.rowIndex, {
          status: 'DELETE_FAILED',
          errorMessage: e.message
        });
      }
    }

    Logger.log('=== 期限切れファイル削除完了 ===');
    Logger.log('削除ファイル数: ' + deletedCount);
    Logger.log('エラー数: ' + errors.length);

    if (errors.length > 0) {
      Logger.log('エラー詳細: ' + JSON.stringify(errors, null, 2));
    }

    return {
      processed: expiredEntries.length,
      deleted: deletedCount,
      errors: errors
    };

  } catch (e) {
    Logger.log('=== 削除処理エラー: ' + e.message + ' ===');
    throw e;
  }
}

/**
 * リンクからファイルIDを抽出
 */
function extractFileIdFromLink(link) {
  var patterns = [
    /\/file\/d\/([a-zA-Z0-9_-]+)/,
    /[?&]id=([a-zA-Z0-9_-]+)/
  ];

  for (var i = 0; i < patterns.length; i++) {
    var match = link.match(patterns[i]);
    if (match && match[1]) {
      return match[1];
    }
  }

  return null;
}

/**
 * ファイルを削除（ゴミ箱 or 完全削除）
 */
function deleteFile(fileId) {
  try {
    Logger.log('  ファイル削除: ' + fileId);

    if (SYS.LIFECYCLE.DELETE_MODE === 'permanent') {
      // 完全削除
      Drive.Files.remove(fileId, {
        supportsAllDrives: true
      });
      Logger.log('    → 完全削除');

    } else {
      // ゴミ箱へ移動（デフォルト）
      Drive.Files.update(
        { trashed: true },
        fileId,
        null,
        { supportsAllDrives: true }
      );
      Logger.log('    → ゴミ箱へ移動');
    }

  } catch (e) {
    // ファイルが既に削除されている場合はエラーとしない
    if (e.message.indexOf('File not found') !== -1 || e.message.indexOf('404') !== -1) {
      Logger.log('    → 既に削除済み');
    } else {
      throw e;
    }
  }
}

/**
 * ログエントリーを行インデックスで更新
 * @param {number} rowIndex - 行番号（1-based）
 * @param {Object} updates - 更新データ
 */
function updateLogEntryByRow(rowIndex, updates) {
  try {
    var ssId = SYS.LOG_SPREADSHEET_ID;
    if (!ssId) {
      return;
    }

    var ss = SpreadsheetApp.openById(ssId);
    var sheet = ss.getSheetByName('Logs');

    if (!sheet) {
      return;
    }

    // 更新（列インデックスはLogger.gsと同じ）
    if (updates.status) {
      sheet.getRange(rowIndex, 13).setValue(updates.status);  // 列13: Status
    }

    if (updates.errorMessage) {
      sheet.getRange(rowIndex, 14).setValue(updates.errorMessage);  // 列14: ErrorMessage
    }

  } catch (e) {
    Logger.log('ログ更新エラー (row=' + rowIndex + '): ' + e.message);
  }
}

/**
 * 手動テスト: 期限切れファイル確認（削除はしない）
 */
function testCheckExpiredFiles() {
  Logger.log('=== 期限切れファイル確認 ===');

  var expiredEntries = getExpiredLogEntries();

  Logger.log('期限切れエントリー: ' + expiredEntries.length + ' 件');

  for (var i = 0; i < expiredEntries.length; i++) {
    var entry = expiredEntries[i];
    Logger.log((i + 1) + ': ' + entry.trackingId);
    Logger.log('   期限: ' + entry.expiryAt);
    Logger.log('   ファイル数: ' + entry.encryptedLinks.length);
    Logger.log('   ステータス: ' + entry.status);
  }

  Logger.log('=== 確認完了 ===');
}

/**
 * 手動テスト: ファイルID抽出
 */
function testExtractFileId() {
  Logger.log('=== ファイルID抽出テスト ===');

  var testLinks = [
    'https://drive.google.com/file/d/1ABC123xyz/view?usp=sharing',
    'https://drive.google.com/open?id=1XYZ789abc',
    'https://drive.google.com/file/d/1TEST456def/edit',
    'invalid link'
  ];

  for (var i = 0; i < testLinks.length; i++) {
    var link = testLinks[i];
    var fileId = extractFileIdFromLink(link);
    Logger.log((i + 1) + ': ' + link);
    Logger.log('   → ' + (fileId || '(null)'));
  }

  Logger.log('=== テスト完了 ===');
}

/**
 * 緊急用: 特定の追跡IDのファイルを即座に削除
 * @param {string} trackingId - 追跡ID
 */
function emergencyDeleteByTrackingId(trackingId) {
  Logger.log('=== 緊急削除: ' + trackingId + ' ===');

  var entry = getLogEntry(trackingId);

  if (!entry) {
    Logger.log('✗ ログエントリーが見つかりません');
    return;
  }

  Logger.log('ファイル数: ' + entry.encryptedLinks.length);

  var deletedCount = 0;

  for (var i = 0; i < entry.encryptedLinks.length; i++) {
    var link = entry.encryptedLinks[i];
    var fileId = extractFileIdFromLink(link);

    if (fileId) {
      try {
        deleteFile(fileId);
        deletedCount++;
        Logger.log('  ✓ 削除: ' + fileId);
      } catch (e) {
        Logger.log('  ✗ 削除エラー: ' + fileId + ' - ' + e.message);
      }
    }
  }

  // ログを更新
  updateLogEntry(trackingId, {
    status: 'EMERGENCY_DELETED'
  });

  Logger.log('=== 緊急削除完了: ' + deletedCount + ' 件 ===');
}
