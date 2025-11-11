/** 完全置換OK：初期フォルダ自動作成＆SECRET_HMAC自動生成 */
function bootstrapSecureLocker() {
  // 共有ドライブID 必須チェック
  var props = PropertiesService.getScriptProperties();
  var sharedDriveId = props.getProperty('SHARED_DRIVE_ID') || SYS.SHARED_DRIVE_ID;

  if (!sharedDriveId) {
    var errorMsg =
      '【セットアップエラー】\n\n' +
      'SHARED_DRIVE_ID が設定されていません。\n\n' +
      '方法1: Script Properties に設定（推奨）\n' +
      '1. GASエディタで「プロジェクトの設定」→「スクリプト プロパティ」を開く\n' +
      '2. 「スクリプト プロパティを追加」をクリック\n' +
      '3. プロパティ: SHARED_DRIVE_ID\n' +
      '4. 値: 共有ドライブのID（例: 0APbz-T9cPss3Uk9PVA）\n\n' +
      '方法2: Config.gs のデフォルト値を設定\n' +
      '1. Config.gs を開く\n' +
      '2. SHARED_DRIVE_ID の行を編集:\n' +
      '   SHARED_DRIVE_ID: props.SHARED_DRIVE_ID || \'あなたの共有ドライブID\',\n\n' +
      '共有ドライブIDの取得方法：\n' +
      '- Google Driveで共有ドライブを開く\n' +
      '- URLから取得: https://drive.google.com/drive/folders/<このID部分>\n\n' +
      '設定後、再度 bootstrapSecureLocker() を実行してください。';

    throw new Error(errorMsg);
  }

  // Script Properties に保存されていない場合は保存
  if (!props.getProperty('SHARED_DRIVE_ID')) {
    Logger.log('Config.gs のデフォルト値を使用: ' + sharedDriveId);
    Logger.log('Script Properties に保存します...');
    props.setProperty('SHARED_DRIVE_ID', sharedDriveId);
  }

  Logger.log('共有ドライブID確認: ' + sharedDriveId);

  var needEnc = !props.getProperty('FOLDER_ENCRYPTED_ID');
  var needLog = !props.getProperty('FOLDER_LOGS_ID');
  var needHmac = !props.getProperty('SECRET_HMAC');

  // Encrypted
  if (needEnc) {
    Logger.log('Encrypted フォルダを作成中...');
    var encId = createFolderInSharedDrive_("Encrypted", sharedDriveId);
    props.setProperty("FOLDER_ENCRYPTED_ID", encId);
    Logger.log("✓ FOLDER_ENCRYPTED_ID => " + encId);
  } else {
    Logger.log('✓ FOLDER_ENCRYPTED_ID は既に設定済み');
  }

  // Logs
  if (needLog) {
    Logger.log('Logs フォルダを作成中...');
    var logId = createFolderInSharedDrive_("Logs", sharedDriveId);
    props.setProperty("FOLDER_LOGS_ID", logId);
    Logger.log("✓ FOLDER_LOGS_ID => " + logId);
  } else {
    Logger.log('✓ FOLDER_LOGS_ID は既に設定済み');
  }

  // SECRET_HMAC: 256-bit をBase64で
  if (needHmac) {
    Logger.log('SECRET_HMAC を生成中...');
    // UUID×3 → SHA-256 → Base64
    var seed = Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid();
    var hash = CryptoJS.SHA256(seed); // 256-bit
    var b64  = CryptoJS.enc.Base64.stringify(hash);
    props.setProperty("SECRET_HMAC", b64);
    Logger.log("✓ SECRET_HMAC 生成完了（256-bit）");
  } else {
    Logger.log('✓ SECRET_HMAC は既に設定済み');
  }

  // 完了メッセージ
  Logger.log('\n=== Bootstrap 完了 ===');
  Logger.log('次のステップ:');
  Logger.log('1. initLogSpreadsheet() を実行');
  Logger.log('2. setupAllTriggers() を実行');
  Logger.log('3. validateConfig() で設定確認');
}

/** 共有ドライブ直下にフォルダを作成してIDを返す */
function createFolderInSharedDrive_(name, sharedDriveId) {
  // Advanced Drive Service が必要（Resources > Advanced Google services > Drive v2 を ON）
  var resource = {
    title: name,
    mimeType: "application/vnd.google-apps.folder",
    parents: [{ id: sharedDriveId }]
  };

  try {
    var file = Drive.Files.insert(resource, null, {
      supportsAllDrives: true
    });
    return file.id;
  } catch (e) {
    Logger.log('フォルダ作成エラー: ' + e.message);
    throw new Error('共有ドライブにフォルダを作成できませんでした: ' + e.message + '\n\n' +
      '確認事項:\n' +
      '1. Drive API (v2) が有効化されているか\n' +
      '2. 共有ドライブIDが正しいか\n' +
      '3. 共有ドライブへの書き込み権限があるか');
  }
}

function showScriptProps() {
  const props = PropertiesService.getScriptProperties().getProperties();
  Logger.log(JSON.stringify({
    FOLDER_ENCRYPTED_ID: props.FOLDER_ENCRYPTED_ID || null,
    FOLDER_LOGS_ID: props.FOLDER_LOGS_ID || null,
    SECRET_HMAC_set: !!props.SECRET_HMAC,
  }, null, 2));
}
