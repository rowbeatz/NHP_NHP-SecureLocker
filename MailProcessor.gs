/**
 * MailProcessor.gs - メール処理エンジン
 * ango@nhp.jp宛のメールを検出・処理
 */

/**
 * メイン処理: 未処理メールを検出して処理
 * トリガーから定期的に実行される
 */
function processIncomingMails() {
  try {
    validateConfig();

    var userEmail = Session.getActiveUser().getEmail();
    Logger.log('=== メール処理開始: ' + userEmail + ' ===');

    // 未処理メールを検索
    var label = getOrCreateLabel(SYS.LABELS.PROCESSED);
    var searchQuery = 'to:' + SYS.TRIGGER_EMAIL + ' -label:' + SYS.LABELS.PROCESSED +
                      ' newer_than:' + SYS.MAIL.SEARCH_WINDOW_DAYS + 'd';

    Logger.log('検索クエリ: ' + searchQuery);
    var threads = GmailApp.search(searchQuery, 0, 10);  // 最大10件

    Logger.log('未処理メール: ' + threads.length + ' 件');

    for (var i = 0; i < threads.length; i++) {
      var thread = threads[i];
      var messages = thread.getMessages();

      // スレッドの最後のメッセージ（ユーザーが送信したもの）を処理
      var message = messages[messages.length - 1];

      try {
        processMessage(message, thread);

        // 処理済みラベルを付与
        thread.addLabel(label);
        Logger.log('✓ メッセージ処理完了: ' + message.getId());

      } catch (e) {
        Logger.log('✗ メッセージ処理エラー: ' + e.message);
        handleProcessingError(message, thread, e);
      }
    }

    Logger.log('=== メール処理完了 ===');

  } catch (e) {
    Logger.log('=== メール処理エラー: ' + e.message + ' ===');
    throw e;
  }
}

/**
 * 個別メッセージの処理
 */
function processMessage(message, thread) {
  var trackingId = generateTrackingId();
  Logger.log('--- 処理開始: ' + trackingId + ' ---');

  // メール情報を取得
  var messageId = message.getId();
  var threadId = thread.getId();
  var subject = message.getSubject();
  var body = message.getBody();  // HTML本文を取得
  var from = message.getFrom();

  Logger.log('From: ' + from);
  Logger.log('Subject: ' + subject);

  // 添付ファイルとDriveリンクを処理
  var processedFiles = [];
  var passwords = {};
  var encryptedLinks = [];

  // 1. 添付ファイルを処理
  var attachments = message.getAttachments();
  Logger.log('添付ファイル数: ' + attachments.length);

  for (var i = 0; i < attachments.length; i++) {
    var attachment = attachments[i];
    var result = processAttachment(attachment, trackingId);

    if (result) {
      processedFiles.push({
        originalName: result.originalName,
        encryptedName: result.encryptedName,
        size: result.size,
        driveLink: result.driveLink
      });
      passwords[result.originalName] = result.password;
      encryptedLinks.push(result.driveLink);
    }
  }

  // 2. Driveリンクを抽出して処理
  var driveLinks = extractDriveLinks(body);
  Logger.log('Driveリンク数: ' + driveLinks.length);

  for (var i = 0; i < driveLinks.length; i++) {
    var link = driveLinks[i];
    try {
      var result = processDriveLink(link, trackingId);

      if (result) {
        processedFiles.push({
          originalName: result.originalName,
          encryptedName: result.encryptedName,
          size: result.size,
          driveLink: result.driveLink
        });
        passwords[result.originalName] = result.password;
        encryptedLinks.push(result.driveLink);
      }
    } catch (e) {
      Logger.log('Driveリンク処理エラー: ' + link.url + ' - ' + e.message);
      // エラーは記録するがスキップして続行
    }
  }

  // 3. 本文を加工（リンク差し替え + 追跡ID追加）
  var modifiedBody = modifyBodyContent(body, driveLinks, processedFiles, trackingId);

  // 4. ログに記録
  var expiryAt = new Date(Date.now() + SYS.LIFECYCLE.VALIDITY_DAYS * 24 * 60 * 60 * 1000);
  addLogEntry({
    trackingId: trackingId,
    ownerEmail: Session.getActiveUser().getEmail(),
    sourceMsgId: messageId,
    sourceThreadId: threadId,
    files: processedFiles,
    passwords: passwords,
    encryptedLinks: encryptedLinks,
    expiryAt: expiryAt.toISOString(),
    status: 'FILES_ENCRYPTED'
  });

  // 5. ドラフトを作成
  createDraftInThread(thread, subject, modifiedBody, trackingId, processedFiles);

  Logger.log('--- 処理完了: ' + trackingId + ' ---');
}

/**
 * 添付ファイルを暗号化してDriveに保存
 */
function processAttachment(attachment, trackingId) {
  try {
    var originalName = attachment.getName();
    var size = attachment.getSize();

    Logger.log('  添付: ' + originalName + ' (' + (size/1024).toFixed(1) + ' KB)');

    // サイズ警告
    if (size > SYS.FILE.MAX_SIZE_MB * 1024 * 1024) {
      Logger.log('  ⚠ サイズ警告: ' + (size/1024/1024).toFixed(1) + ' MB');
    }

    // パスワード生成
    var password = generateSecurePassword();

    // 暗号化
    var encrypted = encryptFile(attachment, password, originalName);

    // Driveに保存
    var driveLink = saveToDrive(encrypted.encryptedBlob, trackingId);

    Logger.log('  ✓ 暗号化完了: ' + encrypted.randomName);

    return {
      originalName: originalName,
      encryptedName: encrypted.randomName,
      size: size,
      password: password,
      driveLink: driveLink
    };

  } catch (e) {
    Logger.log('  ✗ 添付ファイル処理エラー: ' + e.message);
    throw e;
  }
}

/**
 * DriveリンクからファイルをDL・暗号化・再保存
 */
function processDriveLink(linkInfo, trackingId) {
  try {
    var fileId = linkInfo.fileId;
    Logger.log('  Driveファイル: ' + fileId);

    // ファイルを取得
    var file = DriveApp.getFileById(fileId);
    var originalName = file.getName();
    var size = file.getSize();
    var blob = file.getBlob();

    Logger.log('  名前: ' + originalName + ' (' + (size/1024).toFixed(1) + ' KB)');

    // パスワード生成
    var password = generateSecurePassword();

    // 暗号化
    var encrypted = encryptFile(blob, password, originalName);

    // Driveに保存
    var driveLink = saveToDrive(encrypted.encryptedBlob, trackingId);

    Logger.log('  ✓ 暗号化完了: ' + encrypted.randomName);

    return {
      originalName: originalName,
      encryptedName: encrypted.randomName,
      size: size,
      password: password,
      driveLink: driveLink,
      sourceFileId: fileId
    };

  } catch (e) {
    Logger.log('  ✗ Driveファイル処理エラー: ' + e.message);
    throw e;
  }
}

/**
 * 暗号化ファイルをDriveに保存して共有リンクを返す
 */
function saveToDrive(blob, trackingId) {
  try {
    var folderId = SYS.FOLDER_ENCRYPTED_ID;
    if (!folderId) {
      throw new Error('FOLDER_ENCRYPTED_ID が設定されていません');
    }

    // 共有ドライブのフォルダを取得
    var folder = DriveApp.getFolderById(folderId);

    // ファイルを作成（Advanced Drive APIを使用）
    var resource = {
      name: blob.getName(),
      mimeType: blob.getContentType(),
      parents: [folderId]
    };

    var file = Drive.Files.insert(resource, blob, {
      supportsAllDrives: true
    });

    var fileId = file.id;
    Logger.log('  Drive保存: ' + fileId);

    // 共有設定: Anyone with the link
    try {
      Drive.Permissions.insert(
        {
          type: 'anyone',
          role: 'reader',
          withLink: true
        },
        fileId,
        {
          supportsAllDrives: true,
          sendNotificationEmails: false
        }
      );
      Logger.log('  共有設定: Anyone with the link');
    } catch (e) {
      Logger.log('  ⚠ 共有設定エラー（組織ポリシー制限の可能性）: ' + e.message);
      // フォールバック: 個別Viewer追加は後で実装
    }

    // ダウンロードリンクを生成
    var downloadLink = 'https://drive.google.com/file/d/' + fileId + '/view?usp=sharing';

    return downloadLink;

  } catch (e) {
    Logger.log('  ✗ Drive保存エラー: ' + e.message);
    throw e;
  }
}

/**
 * 本文からDriveリンクを抽出
 */
function extractDriveLinks(body) {
  var links = [];
  var patterns = [
    /https:\/\/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/g,
    /https:\/\/drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/g
  ];

  for (var i = 0; i < patterns.length; i++) {
    var pattern = patterns[i];
    var matches;
    while ((matches = pattern.exec(body)) !== null) {
      links.push({
        url: matches[0],
        fileId: matches[1]
      });
    }
  }

  // 重複除去
  var uniqueLinks = [];
  var seen = {};
  for (var i = 0; i < links.length; i++) {
    if (!seen[links[i].fileId]) {
      uniqueLinks.push(links[i]);
      seen[links[i].fileId] = true;
    }
  }

  return uniqueLinks;
}

/**
 * 本文を加工（リンク差し替え + 追跡ID追加）
 */
function modifyBodyContent(body, originalLinks, processedFiles, trackingId) {
  // 元の本文をそのまま保持（HTML形式）
  var modified = body;

  // WebApp URLを生成
  var webappUrl = getWebAppUrl();
  var downloadUrl = webappUrl + '?id=' + trackingId;

  // ファイル一覧を作成（HTML形式）
  var fileListHtml = '';
  if (processedFiles.length > 0) {
    fileListHtml = '<div style="border: 2px solid #4285F4; border-radius: 8px; padding: 20px; margin: 20px 0; background: #f8f9fa;">';
    fileListHtml += '<h3 style="margin: 0 0 15px 0; color: #333;">📎 ダウンロード可能なファイル</h3>';
    fileListHtml += '<ul style="list-style: none; padding: 0; margin: 0;">';
    for (var i = 0; i < processedFiles.length; i++) {
      var file = processedFiles[i];
      var sizeKB = (file.size / 1024).toFixed(1);
      fileListHtml += '<li style="padding: 8px 0; border-bottom: 1px solid #e0e0e0;">';
      fileListHtml += '📄 <strong>' + file.originalName + '</strong> <span style="color: #666;">(' + sizeKB + ' KB)</span>';
      fileListHtml += '</li>';
    }
    fileListHtml += '</ul>';
    fileListHtml += '</div>';
  }

  // ダウンロードリンクを追加（HTML形式）
  var downloadHtml = '';
  downloadHtml += '<div style="border: 2px solid #10b981; border-radius: 8px; padding: 20px; margin: 20px 0; background: #ecfdf5;">';
  downloadHtml += '<h3 style="margin: 0 0 15px 0; color: #065f46;">🔗 ダウンロードページ</h3>';
  downloadHtml += '<p style="margin: 10px 0;"><a href="' + downloadUrl + '" style="color: #2563eb; font-size: 16px; text-decoration: none; font-weight: bold;">';
  downloadHtml += 'ファイルをダウンロード →</a></p>';
  downloadHtml += '<div style="margin-top: 15px; padding: 10px; background: white; border-radius: 4px; font-size: 13px; color: #666;">';
  downloadHtml += '<p style="margin: 5px 0;">✓ ダウンロードにはメールアドレス認証が必要です</p>';
  downloadHtml += '<p style="margin: 5px 0;">✓ パスワードはダウンロードページで発行されます</p>';
  downloadHtml += '<p style="margin: 5px 0;">✓ 有効期限: ' + SYS.LIFECYCLE.VALIDITY_DAYS + '日</p>';
  downloadHtml += '</div>';
  downloadHtml += '</div>';

  // 追跡ID（非表示）
  var trackingHtml = '<div style="display: none;">[#' + trackingId + ']</div>';

  // 元の本文に追加
  modified += fileListHtml + downloadHtml + trackingHtml;

  return modified;
}

/**
 * WebApp URLを取得
 */
function getWebAppUrl() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('WEBAPP_URL');

  if (!url) {
    // WebApp URLが未設定の場合、スクリプトIDから生成
    var scriptId = ScriptApp.getScriptId();
    url = 'https://script.google.com/macros/s/' + scriptId + '/exec';

    Logger.log('WebApp URL未設定。デフォルトURL: ' + url);
    Logger.log('デプロイ後、正しいURLをScript Propertiesに設定してください');
  }

  return url;
}

/**
 * エラー処理
 */
function handleProcessingError(message, thread, error) {
  try {
    var errorLabel = getOrCreateLabel(SYS.LABELS.ERROR);
    thread.addLabel(errorLabel);

    // エラーログ
    Logger.log('エラー詳細: ' + JSON.stringify({
      messageId: message.getId(),
      threadId: thread.getId(),
      error: error.message,
      stack: error.stack
    }, null, 2));

  } catch (e) {
    Logger.log('エラー処理自体がエラー: ' + e.message);
  }
}

/**
 * Gmailラベルを取得または作成
 */
function getOrCreateLabel(labelName) {
  var label = GmailApp.getUserLabelByName(labelName);
  if (!label) {
    label = GmailApp.createLabel(labelName);
    Logger.log('ラベル作成: ' + labelName);
  }
  return label;
}

/**
 * テスト用: メール処理のドライラン
 */
function testProcessIncomingMails() {
  Logger.log('=== メール処理テスト ===');
  processIncomingMails();
  Logger.log('=== テスト完了 ===');
}
