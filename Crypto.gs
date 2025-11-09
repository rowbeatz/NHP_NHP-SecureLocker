/**
 * Crypto.gs - 暗号化/復号化エンジン
 * AES-256-CBC + HMAC-SHA256 (Encrypt-then-MAC)
 * 依存: cryptojs_min.gs
 */

/**
 * 24桁の強力なパスワードを生成
 * 要件: 英大文字、英小文字、数字、記号を各1文字以上含む
 */
function generateSecurePassword() {
  var cfg = SYS.CRYPTO.PASSWORD_CHARSET;
  var length = SYS.CRYPTO.PASSWORD_LENGTH;

  // 各カテゴリから最低1文字を確保
  var password = [
    cfg.UPPER.charAt(Math.floor(Math.random() * cfg.UPPER.length)),
    cfg.LOWER.charAt(Math.floor(Math.random() * cfg.LOWER.length)),
    cfg.DIGIT.charAt(Math.floor(Math.random() * cfg.DIGIT.length)),
    cfg.SYMBOL.charAt(Math.floor(Math.random() * cfg.SYMBOL.length))
  ];

  // 全文字種を結合
  var allChars = cfg.UPPER + cfg.LOWER + cfg.DIGIT + cfg.SYMBOL;

  // 残りをランダムに追加
  for (var i = password.length; i < length; i++) {
    password.push(allChars.charAt(Math.floor(Math.random() * allChars.length)));
  }

  // シャッフル（Fisher-Yates）
  for (var i = password.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var temp = password[i];
    password[i] = password[j];
    password[j] = temp;
  }

  return password.join('');
}

/**
 * 追跡IDを生成
 * 形式: ANGO-XXXXXXXX (8桁英数字大文字)
 */
function generateTrackingId() {
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  var id = '';
  for (var i = 0; i < SYS.TRACKING.LENGTH; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return SYS.TRACKING.PREFIX + id;
}

/**
 * ファイルを暗号化
 * @param {Blob} blob - 暗号化するファイル（GAS Blob）
 * @param {string} password - 24桁パスワード
 * @param {string} originalName - 元のファイル名
 * @return {Object} { encryptedBlob, header }
 */
function encryptFile(blob, password, originalName) {
  try {
    // ファイルデータを取得
    var fileBytes = blob.getBytes();
    var fileData = Utilities.newBlob(fileBytes).getDataAsString('ISO-8859-1');

    // Salt と IV を生成（各16バイト）
    var salt = CryptoJS.lib.WordArray.random(16);
    var iv = CryptoJS.lib.WordArray.random(16);

    // PBKDF2でパスワードから鍵を導出
    var key = CryptoJS.PBKDF2(password, salt, {
      keySize: 256/32,  // 256 bits = 8 words
      iterations: SYS.CRYPTO.ITERATIONS,
      hasher: CryptoJS.algo.SHA256
    });

    // 平文をWordArrayに変換
    var plaintextWA = CryptoJS.enc.Latin1.parse(fileData);

    // AES-256-CBCで暗号化
    var encrypted = CryptoJS.AES.encrypt(plaintextWA, key, {
      iv: iv,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7
    });

    var ciphertext = encrypted.ciphertext;

    // HMACでMACを計算（Encrypt-then-MAC）
    var hmacKey = CryptoJS.enc.Base64.parse(SYS.SECRET_HMAC);
    var dataToMac = salt.concat(iv).concat(ciphertext);
    var mac = CryptoJS.HmacSHA256(dataToMac, hmacKey);

    // ヘッダー情報
    var header = {
      version: '1.0',
      algorithm: 'AES-256-CBC',
      kdf: 'PBKDF2',
      kdfIter: SYS.CRYPTO.ITERATIONS,
      kdfSaltB64: CryptoJS.enc.Base64.stringify(salt),
      ivB64: CryptoJS.enc.Base64.stringify(iv),
      macB64: CryptoJS.enc.Base64.stringify(mac),
      originalName: originalName,
      mimeType: blob.getContentType(),
      sizeBytes: fileBytes.length,
      createdAt: new Date().toISOString()
    };

    // パッケージ構造: JSON Header + "\n---\n" + Base64 Ciphertext
    var headerJson = JSON.stringify(header);
    var ciphertextB64 = CryptoJS.enc.Base64.stringify(ciphertext);
    var packageContent = headerJson + '\n---\n' + ciphertextB64;

    // ランダムなファイル名を生成
    var randomName = Utilities.getUuid().substring(0, 8) + SYS.FILE.ENCRYPTED_EXTENSION;

    var encryptedBlob = Utilities.newBlob(packageContent, 'text/plain', randomName);

    return {
      encryptedBlob: encryptedBlob,
      header: header,
      randomName: randomName
    };

  } catch (e) {
    Logger.log('暗号化エラー: ' + e.message);
    throw new Error('ファイルの暗号化に失敗しました: ' + e.message);
  }
}

/**
 * ファイルを復号化（サーバー側での検証・テスト用）
 * 注: 実際の復号は受信者のブラウザで行う（decrypt.html）
 * @param {string} packageContent - 暗号化パッケージの内容
 * @param {string} password - 復号パスワード
 * @return {Blob} 復号されたファイル
 */
function decryptFile(packageContent, password) {
  try {
    // ヘッダーとデータを分離
    var parts = packageContent.split('\n---\n');
    if (parts.length !== 2) {
      throw new Error('無効なパッケージ形式');
    }

    var header = JSON.parse(parts[0]);
    var ciphertextB64 = parts[1];

    // Base64デコード
    var salt = CryptoJS.enc.Base64.parse(header.kdfSaltB64);
    var iv = CryptoJS.enc.Base64.parse(header.ivB64);
    var ciphertext = CryptoJS.enc.Base64.parse(ciphertextB64);
    var expectedMac = CryptoJS.enc.Base64.parse(header.macB64);

    // MAC検証
    var hmacKey = CryptoJS.enc.Base64.parse(SYS.SECRET_HMAC);
    var dataToMac = salt.concat(iv).concat(ciphertext);
    var computedMac = CryptoJS.HmacSHA256(dataToMac, hmacKey);

    if (computedMac.toString() !== expectedMac.toString()) {
      throw new Error('MAC検証失敗: データが改ざんされている可能性があります');
    }

    // 鍵の導出
    var key = CryptoJS.PBKDF2(password, salt, {
      keySize: 256/32,
      iterations: header.kdfIter,
      hasher: CryptoJS.algo.SHA256
    });

    // 復号
    var decrypted = CryptoJS.AES.decrypt(
      { ciphertext: ciphertext },
      key,
      {
        iv: iv,
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7
      }
    );

    // WordArrayをバイナリに変換
    var plaintextStr = CryptoJS.enc.Latin1.stringify(decrypted);
    var blob = Utilities.newBlob(plaintextStr, header.mimeType, header.originalName);

    return blob;

  } catch (e) {
    Logger.log('復号エラー: ' + e.message);
    throw new Error('ファイルの復号に失敗しました: ' + e.message);
  }
}

/**
 * 暗号化のセルフテスト
 */
function selfTest_EncryptSmallBlob() {
  Logger.log('=== 暗号化セルフテスト開始 ===');

  // テストデータ
  var testContent = 'これはテストデータです。This is a test file content.\n日本語とEnglishの混在テスト。';
  var testBlob = Utilities.newBlob(testContent, 'text/plain', 'test.txt');
  var password = generateSecurePassword();

  Logger.log('生成パスワード: ' + password);
  Logger.log('テストデータサイズ: ' + testContent.length + ' bytes');

  // 暗号化
  var encrypted = encryptFile(testBlob, password, 'test.txt');
  Logger.log('暗号化成功: ' + encrypted.randomName);
  Logger.log('ヘッダー: ' + JSON.stringify(encrypted.header, null, 2));

  // 復号
  var packageContent = encrypted.encryptedBlob.getDataAsString();
  var decrypted = decryptFile(packageContent, password);
  var decryptedContent = decrypted.getDataAsString();

  Logger.log('復号成功: ' + decrypted.getName());
  Logger.log('復号データサイズ: ' + decryptedContent.length + ' bytes');

  // 検証
  if (decryptedContent === testContent) {
    Logger.log('✓ セルフテスト成功: 元データと復号データが一致');
    return { success: true, password: password };
  } else {
    Logger.log('✗ セルフテスト失敗: データ不一致');
    Logger.log('元データ: ' + testContent);
    Logger.log('復号データ: ' + decryptedContent);
    throw new Error('セルフテスト失敗');
  }
}

/**
 * パスワード生成のテスト
 */
function testPasswordGeneration() {
  Logger.log('=== パスワード生成テスト ===');
  for (var i = 0; i < 10; i++) {
    var pw = generateSecurePassword();
    Logger.log((i+1) + ': ' + pw);

    // 検証
    var hasUpper = /[A-Z]/.test(pw);
    var hasLower = /[a-z]/.test(pw);
    var hasDigit = /[0-9]/.test(pw);
    var hasSymbol = /[!@#$%^&*()\-_=+\[\]{}|;:,.<>?]/.test(pw);

    if (!hasUpper || !hasLower || !hasDigit || !hasSymbol) {
      Logger.log('  ✗ 要件不足: U=' + hasUpper + ' L=' + hasLower + ' D=' + hasDigit + ' S=' + hasSymbol);
    }
  }
  Logger.log('=== テスト完了 ===');
}

/**
 * 追跡ID生成のテスト
 */
function testTrackingIdGeneration() {
  Logger.log('=== 追跡ID生成テスト ===');
  for (var i = 0; i < 10; i++) {
    var tid = generateTrackingId();
    Logger.log((i+1) + ': ' + tid);
  }
  Logger.log('=== テスト完了 ===');
}
