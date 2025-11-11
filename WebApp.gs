/**
 * WebApp.gs - Webアプリケーション（ダウンロードページ）
 * GAS Web Appとしてデプロイして使用
 */

/**
 * GETリクエスト処理（ダウンロードページ表示）
 * @param {Object} e - イベントオブジェクト
 * @return {HtmlOutput} HTMLページ
 */
function doGet(e) {
  try {
    var trackingId = e.parameter.id;

    if (!trackingId) {
      return HtmlService.createHtmlOutput('<h1>エラー</h1><p>無効なURLです。</p>');
    }

    // トラッキングIDの検証とログエントリー取得
    var logEntry = getLogEntry(trackingId);

    if (!logEntry) {
      return HtmlService.createHtmlOutput('<h1>エラー</h1><p>ダウンロードリンクが見つかりません。</p>');
    }

    // 有効期限チェック
    var expiryDate = new Date(logEntry.expiryAt);
    var now = new Date();

    if (now > expiryDate) {
      return HtmlService.createHtmlOutput(
        '<h1>期限切れ</h1><p>このダウンロードリンクは有効期限が切れています。</p>' +
        '<p>有効期限: ' + expiryDate.toLocaleString('ja-JP') + '</p>'
      );
    }

    // ダウンロードページHTMLを生成
    var template = HtmlService.createTemplateFromFile('DownloadPage');
    template.trackingId = trackingId;
    template.files = logEntry.files || [];
    template.expiryAt = expiryDate.toLocaleString('ja-JP');

    return template.evaluate()
      .setTitle('NHP SecureLocker - ファイルダウンロード')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);

  } catch (e) {
    Logger.log('doGet エラー: ' + e.message);
    return HtmlService.createHtmlOutput('<h1>エラー</h1><p>システムエラーが発生しました。</p>');
  }
}

/**
 * POSTリクエスト処理（API）
 * @param {Object} e - イベントオブジェクト
 * @return {TextOutput} JSON レスポンス
 */
function doPost(e) {
  try {
    var action = e.parameter.action;

    if (action === 'verify-email') {
      return handleVerifyEmail(e);
    } else if (action === 'verify-password') {
      return handleVerifyPassword(e);
    } else if (action === 'download') {
      return handleDownload(e);
    } else {
      return createJsonResponse({ success: false, message: '不明なアクション' });
    }

  } catch (error) {
    Logger.log('doPost エラー: ' + error.message);
    return createJsonResponse({ success: false, message: 'システムエラー' });
  }
}

/**
 * メールアドレス検証＋パスワード発行
 */
function handleVerifyEmail(e) {
  try {
    var trackingId = e.parameter.trackingId;
    var email = e.parameter.email;

    if (!trackingId || !email) {
      return createJsonResponse({ success: false, message: 'パラメータ不足' });
    }

    // ログエントリー取得
    var logEntry = getLogEntry(trackingId);

    if (!logEntry) {
      return createJsonResponse({ success: false, message: 'トラッキングIDが無効です' });
    }

    // ホワイトリストチェック
    var whitelist = logEntry.whitelist || [];
    var normalizedEmail = email.toLowerCase().trim();
    var isWhitelisted = false;

    for (var i = 0; i < whitelist.length; i++) {
      if (whitelist[i].toLowerCase().trim() === normalizedEmail) {
        isWhitelisted = true;
        break;
      }
    }

    if (!isWhitelisted) {
      return createJsonResponse({
        success: false,
        message: 'このメールアドレスは送信先リストに含まれていません。'
      });
    }

    // パスワード生成
    var password = generateSecurePassword();

    // パスワードを保存（Script Properties に一時保存、10分後に削除）
    var passwordKey = 'pwd_' + trackingId + '_' + Utilities.getUuid().substring(0, 8);
    var props = PropertiesService.getScriptProperties();
    props.setProperty(passwordKey, JSON.stringify({
      password: password,
      email: normalizedEmail,
      createdAt: new Date().getTime(),
      used: false
    }));

    // パスワードをメール送信
    sendPasswordEmail(normalizedEmail, password, trackingId);

    // ログ更新
    updateLogEntry(trackingId, {
      passwordRequested: true,
      passwordRequestedAt: new Date().toISOString(),
      passwordRequestEmail: normalizedEmail
    });

    return createJsonResponse({
      success: true,
      message: 'パスワードを ' + normalizedEmail + ' に送信しました。',
      passwordKey: passwordKey
    });

  } catch (error) {
    Logger.log('handleVerifyEmail エラー: ' + error.message);
    return createJsonResponse({ success: false, message: 'エラーが発生しました' });
  }
}

/**
 * パスワード検証
 */
function handleVerifyPassword(e) {
  try {
    var passwordKey = e.parameter.passwordKey;
    var inputPassword = e.parameter.password;

    if (!passwordKey || !inputPassword) {
      return createJsonResponse({ success: false, message: 'パラメータ不足' });
    }

    // パスワード情報を取得
    var props = PropertiesService.getScriptProperties();
    var passwordDataStr = props.getProperty(passwordKey);

    if (!passwordDataStr) {
      return createJsonResponse({ success: false, message: 'パスワードが無効または期限切れです' });
    }

    var passwordData = JSON.parse(passwordDataStr);

    // 使用済みチェック
    if (passwordData.used) {
      return createJsonResponse({ success: false, message: 'このパスワードは既に使用されています' });
    }

    // 有効期限チェック（10分）
    var now = new Date().getTime();
    var elapsed = now - passwordData.createdAt;
    var tenMinutes = 10 * 60 * 1000;

    if (elapsed > tenMinutes) {
      props.deleteProperty(passwordKey);
      return createJsonResponse({ success: false, message: 'パスワードの有効期限が切れています（10分）' });
    }

    // パスワード照合
    if (inputPassword !== passwordData.password) {
      return createJsonResponse({ success: false, message: 'パスワードが正しくありません' });
    }

    // 使用済みフラグを立てる
    passwordData.used = true;
    props.setProperty(passwordKey, JSON.stringify(passwordData));

    return createJsonResponse({
      success: true,
      message: 'パスワードが確認されました。ダウンロードを開始できます。'
    });

  } catch (error) {
    Logger.log('handleVerifyPassword エラー: ' + error.message);
    return createJsonResponse({ success: false, message: 'エラーが発生しました' });
  }
}

/**
 * ファイルダウンロード処理
 */
function handleDownload(e) {
  try {
    var trackingId = e.parameter.trackingId;
    var passwordKey = e.parameter.passwordKey;

    if (!trackingId || !passwordKey) {
      return createJsonResponse({ success: false, message: 'パラメータ不足' });
    }

    // パスワード検証
    var props = PropertiesService.getScriptProperties();
    var passwordDataStr = props.getProperty(passwordKey);

    if (!passwordDataStr) {
      return createJsonResponse({ success: false, message: '認証情報が無効です' });
    }

    var passwordData = JSON.parse(passwordDataStr);

    if (!passwordData.used) {
      return createJsonResponse({ success: false, message: 'パスワードが未検証です' });
    }

    // ログエントリー取得
    var logEntry = getLogEntry(trackingId);

    if (!logEntry) {
      return createJsonResponse({ success: false, message: 'ファイル情報が見つかりません' });
    }

    var files = logEntry.files || [];
    var passwords = logEntry.passwords || {};

    if (files.length === 0) {
      return createJsonResponse({ success: false, message: 'ダウンロード可能なファイルがありません' });
    }

    // ファイルを復号してダウンロード準備
    var decryptedBlobs = [];

    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      var password = passwords[file.originalName];

      if (!password) {
        Logger.log('パスワードが見つかりません: ' + file.originalName);
        continue;
      }

      try {
        // 暗号化ファイルをDriveから取得
        var fileId = extractFileIdFromLink(file.driveLink);
        var encryptedFile = DriveApp.getFileById(fileId);
        var packageContent = encryptedFile.getBlob().getDataAsString();

        // 復号
        var decryptedBlob = decryptFile(packageContent, password);
        decryptedBlobs.push(decryptedBlob);

      } catch (error) {
        Logger.log('ファイル復号エラー: ' + file.originalName + ' - ' + error.message);
      }
    }

    if (decryptedBlobs.length === 0) {
      return createJsonResponse({ success: false, message: 'ファイルの復号に失敗しました' });
    }

    // 1ファイルならそのまま、複数ならZIP化
    var downloadBlob;

    if (decryptedBlobs.length === 1) {
      downloadBlob = decryptedBlobs[0];
    } else {
      // ZIP化
      downloadBlob = Utilities.zip(decryptedBlobs, trackingId + '_files.zip');
    }

    // ダウンロード用URLを生成（一時的にDriveに保存）
    var tempFolder = getTempDownloadFolder();
    var tempFile = tempFolder.createFile(downloadBlob);
    tempFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    var downloadUrl = tempFile.getDownloadUrl();

    // 10分後に削除するトリガーを設定
    scheduleFileDeletion(tempFile.getId(), 10);

    // ログ更新
    updateLogEntry(trackingId, {
      downloadedAt: new Date().toISOString(),
      downloadedBy: passwordData.email,
      status: 'DOWNLOADED'
    });

    return createJsonResponse({
      success: true,
      downloadUrl: downloadUrl,
      fileName: downloadBlob.getName()
    });

  } catch (error) {
    Logger.log('handleDownload エラー: ' + error.message);
    return createJsonResponse({ success: false, message: 'ダウンロード処理に失敗しました' });
  }
}

/**
 * パスワード送信メール
 */
function sendPasswordEmail(email, password, trackingId) {
  var subject = '[NHP SecureLocker] ダウンロードパスワード通知';
  var body = 'ファイルをダウンロードするためのパスワードをお知らせします。\n\n' +
             '━━━━━━━━━━━━━━━━━━━━━━\n' +
             'パスワード: ' + password + '\n' +
             '━━━━━━━━━━━━━━━━━━━━━━\n\n' +
             '追跡ID: ' + trackingId + '\n' +
             '有効期限: 10分\n\n' +
             'このパスワードをダウンロードページに入力してください。\n' +
             'パスワードは1回のみ使用可能です。\n\n' +
             '※このメールは自動送信されています。';

  MailApp.sendEmail({
    to: email,
    subject: subject,
    body: body
  });

  Logger.log('パスワードメール送信: ' + email);
}

/**
 * 一時ダウンロード用フォルダを取得
 */
function getTempDownloadFolder() {
  var props = PropertiesService.getScriptProperties();
  var folderId = props.getProperty('FOLDER_TEMP_DOWNLOAD_ID');

  if (folderId) {
    try {
      return DriveApp.getFolderById(folderId);
    } catch (e) {
      // フォルダが削除されている場合は再作成
    }
  }

  // フォルダ作成
  var sharedDriveId = props.getProperty('SHARED_DRIVE_ID');
  var resource = {
    title: 'TempDownloads',
    mimeType: 'application/vnd.google-apps.folder',
    parents: [{ id: sharedDriveId }]
  };

  var folder = Drive.Files.insert(resource, null, { supportsAllDrives: true });
  props.setProperty('FOLDER_TEMP_DOWNLOAD_ID', folder.id);

  return DriveApp.getFolderById(folder.id);
}

/**
 * ファイル削除スケジュール（10分後）
 */
function scheduleFileDeletion(fileId, minutes) {
  // GASのトリガーは最小1分単位なので、PropertiesServiceに記録して定期削除トリガーで処理
  var props = PropertiesService.getScriptProperties();
  var deleteAt = new Date().getTime() + (minutes * 60 * 1000);

  props.setProperty('temp_file_' + fileId, deleteAt.toString());
}

/**
 * DriveリンクからファイルIDを抽出
 */
function extractFileIdFromLink(url) {
  var match = url.match(/\/file\/d\/([^\/]+)/);
  if (match && match[1]) {
    return match[1];
  }

  match = url.match(/id=([^&]+)/);
  if (match && match[1]) {
    return match[1];
  }

  throw new Error('ファイルIDを抽出できません: ' + url);
}

/**
 * JSON レスポンス生成
 */
function createJsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * クライアント側から呼ばれる関数（google.script.run用）
 */

function handleVerifyEmailFromClient(trackingId, email) {
  return JSON.parse(handleVerifyEmail({
    parameter: { trackingId: trackingId, email: email }
  }).getContent());
}

function handleVerifyPasswordFromClient(passwordKey, password) {
  return JSON.parse(handleVerifyPassword({
    parameter: { passwordKey: passwordKey, password: password }
  }).getContent());
}

function handleDownloadFromClient(trackingId, passwordKey) {
  return JSON.parse(handleDownload({
    parameter: { trackingId: trackingId, passwordKey: passwordKey }
  }).getContent());
}
