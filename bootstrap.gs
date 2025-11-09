/** 完全置換OK：初期フォルダ自動作成＆SECRET_HMAC自動生成 */
function bootstrapSecureLocker() {
  // 共有ドライブID 必須
  if (!SYS.SHARED_DRIVE_ID) throw new Error("0APbz-T9cPss3Uk9PVA");

  const props = PropertiesService.getScriptProperties();
  const needEnc = !SYS.FOLDER_ENCRYPTED_ID;
  const needLog = !SYS.FOLDER_LOGS_ID;
  const needHmac = !SYS.SECRET_HMAC;

  // Encrypted
  if (needEnc) {
    const encId = createFolderInSharedDrive_("Encrypted");
    props.setProperty("FOLDER_ENCRYPTED_ID", encId);
    Logger.log("FOLDER_ENCRYPTED_ID => " + encId);
  }

  // Logs
  if (needLog) {
    const logId = createFolderInSharedDrive_("Logs");
    props.setProperty("FOLDER_LOGS_ID", logId);
    Logger.log("FOLDER_LOGS_ID => " + logId);
  }

  // SECRET_HMAC: 256-bit をBase64で
  if (needHmac) {
    // できれば外部で安全に生成した値を貼るのが最善（openssl等）。
    // ここではGAS内で「UUID×3 → SHA-256 → Base64」による生成を用意。
    const seed = Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid();
    const hash = CryptoJS.SHA256(seed); // 256-bit
    const b64  = CryptoJS.enc.Base64.stringify(hash);
    props.setProperty("SECRET_HMAC", b64);
    Logger.log("SECRET_HMAC（生成）");
  }

  // 反映確認
  Logger.log("Done. Script Properties を再読込して反映してください。");
}

/** 共有ドライブ直下にフォルダを作成してIDを返す */
function createFolderInSharedDrive_(name) {
  // Advanced Drive Service が必要（Resources > Advanced Google services > Drive v3 を ON）
  const resource = {
    name: name,
    mimeType: "application/vnd.google-apps.folder",
    parents: [SYS.SHARED_DRIVE_ID]
  };
  const file = Drive.Files.create(
    resource,
    null,
    { supportsAllDrives: true }
  );
  return file.id;
}

function showScriptProps() {
  const props = PropertiesService.getScriptProperties().getProperties();
  Logger.log(JSON.stringify({
    FOLDER_ENCRYPTED_ID: props.FOLDER_ENCRYPTED_ID || null,
    FOLDER_LOGS_ID: props.FOLDER_LOGS_ID || null,
    SECRET_HMAC_set: !!props.SECRET_HMAC,
  }, null, 2));
}
