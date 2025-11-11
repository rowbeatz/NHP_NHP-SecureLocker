/**
 * Config.gs - システム設定と定数
 * executeAsUser前提のため、各ユーザーのScript Propertiesを使用
 */

// ========== グローバル設定オブジェクト ==========
var SYS = (function() {
  var props = PropertiesService.getScriptProperties().getProperties();

  return {
    // トリガーメールアドレス（この宛先へ送信されたメールを処理）
    TRIGGER_EMAIL: 'y-furusawa+ango@nhp.jp',

    // 共有ドライブID（必須：事前に共有ドライブのIDを設定）
    // ※ bootstrap実行前にこの値をScript Propertiesに設定すること
    SHARED_DRIVE_ID: props.SHARED_DRIVE_ID || '',

    // 暗号化ファイル保存先フォルダID（bootstrapで自動生成）
    FOLDER_ENCRYPTED_ID: props.FOLDER_ENCRYPTED_ID || '',

    // ログフォルダID（bootstrapで自動生成）
    FOLDER_LOGS_ID: props.FOLDER_LOGS_ID || '',

    // HMAC秘密鍵（Base64、bootstrapで自動生成）
    SECRET_HMAC: props.SECRET_HMAC || '',

    // ログSpreadsheet ID（初回実行時に自動生成）
    LOG_SPREADSHEET_ID: props.LOG_SPREADSHEET_ID || '',

    // ========== 暗号化設定 ==========
    CRYPTO: {
      ALGORITHM: 'AES-256-CBC',
      KEY_SIZE: 256,
      BLOCK_SIZE: 128,
      ITERATIONS: 10000, // PBKDF2 iterations (GAS環境に最適化、NIST推奨値)
      PASSWORD_LENGTH: 24,
      PASSWORD_CHARSET: {
        UPPER: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
        LOWER: 'abcdefghijklmnopqrstuvwxyz',
        DIGIT: '0123456789',
        SYMBOL: '!@#$%^&*()-_=+[]{}|;:,.<>?'
      }
    },

    // ========== ライフサイクル設定 ==========
    LIFECYCLE: {
      VALIDITY_DAYS: 14,   // 有効期限（日）
      DELETE_AFTER_DAYS: 15, // 削除実行（日）
      DELETE_MODE: 'trash'   // 'trash' または 'permanent'
    },

    // ========== Gmail ラベル ==========
    LABELS: {
      PROCESSED: 'es_processed',      // 処理済み（入力メール）
      DRAFT_CREATED: 'es_draft_created', // ドラフト作成済み
      PW_SENT: 'es_pw_sent',          // パスワード送信済み
      ERROR: 'es_error'                // エラー
    },

    // ========== 追跡ID設定 ==========
    TRACKING: {
      PREFIX: 'ANGO-',
      LENGTH: 8,  // ランダム部分の長さ
      PATTERN: /\[#ANGO-([A-Z0-9]{8})\]/  // 抽出用正規表現
    },

    // ========== メール設定 ==========
    MAIL: {
      PASSWORD_SUBJECT_PREFIX: '【パスワード送付】',
      PASSWORD_VALIDITY_TEXT: '有効期限: 14日',
      SEARCH_WINDOW_DAYS: 7,  // メール検索範囲（日）
      BCC_SELF: true  // 送信者自身をBCCに追加
    },

    // ========== エラーハンドリング ==========
    ERROR: {
      MAX_RETRIES: 3,
      RETRY_DELAY_MS: 1000
    },

    // ========== ファイル設定 ==========
    FILE: {
      ENCRYPTED_EXTENSION: '.yenc',
      MAX_SIZE_MB: 30,  // 添付ファイル最大サイズ（MB）警告閾値
      SHARE_MODE: 'anyone_with_link'  // 'anyone_with_link' or 'specific_viewers'
    }
  };
})();

/**
 * 設定値検証（bootstrap後に実行）
 */
function validateConfig() {
  var errors = [];

  if (!SYS.SHARED_DRIVE_ID) {
    errors.push('SHARED_DRIVE_ID が設定されていません');
  }

  if (!SYS.FOLDER_ENCRYPTED_ID) {
    errors.push('FOLDER_ENCRYPTED_ID が設定されていません（bootstrapを実行してください）');
  }

  if (!SYS.SECRET_HMAC) {
    errors.push('SECRET_HMAC が設定されていません（bootstrapを実行してください）');
  }

  if (errors.length > 0) {
    throw new Error('設定エラー:\n' + errors.join('\n'));
  }

  Logger.log('✓ 設定検証OK');
  return true;
}

/**
 * Script Propertiesに設定値を保存（管理用）
 */
function setScriptProperty(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, value);
  Logger.log('設定保存: ' + key);
}

/**
 * Script Properties一覧表示（デバッグ用）
 */
function showAllProperties() {
  var props = PropertiesService.getScriptProperties().getProperties();
  Logger.log('=== Script Properties ===');
  Logger.log(JSON.stringify(props, null, 2));
}
