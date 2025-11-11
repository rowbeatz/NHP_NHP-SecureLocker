/**
 * PasswordNotifier.gs - パスワード通知
 * 送信済みメールから宛先を抽出してパスワードを送信
 */

/**
 * メイン処理: 送信済みメールを検出してパスワードを送信
 * トリガーから定期的に実行される
 */
function processSentMailsForPassword() {
  try {
    var userEmail = Session.getActiveUser().getEmail();
    Logger.log('=== パスワード送信処理開始: ' + userEmail + ' ===');

    // 送信済みメールから追跡ID付きメールを検索
    var pwSentLabel = getOrCreateLabel(SYS.LABELS.PW_SENT);
    var searchQuery = 'in:sent -label:' + SYS.LABELS.PW_SENT +
                      ' newer_than:' + SYS.MAIL.SEARCH_WINDOW_DAYS + 'd';

    Logger.log('検索クエリ: ' + searchQuery);
    var threads = GmailApp.search(searchQuery, 0, 20);  // 最大20件

    Logger.log('送信済みスレッド: ' + threads.length + ' 件');

    var processedCount = 0;

    for (var i = 0; i < threads.length; i++) {
      var thread = threads[i];
      var messages = thread.getMessages();

      // スレッド内の送信済みメッセージを確認
      for (var j = 0; j < messages.length; j++) {
        var message = messages[j];

        // 送信者が自分かチェック
        var from = message.getFrom();
        if (from.indexOf(userEmail) === -1) {
          continue;  // 自分が送信したメールではない
        }

        // 本文から追跡IDを抽出
        var body = message.getPlainBody();
        var trackingId = extractTrackingId(body);

        if (!trackingId) {
          continue;  // 追跡IDなし
        }

        Logger.log('追跡ID検出: ' + trackingId);

        // ログからパスワード情報を取得
        var logEntry = getLogEntry(trackingId);

        if (!logEntry) {
          Logger.log('  ログエントリーが見つかりません: ' + trackingId);
          continue;
        }

        if (Object.keys(logEntry.passwords).length === 0) {
          Logger.log('  パスワード情報なし: ' + trackingId);
          continue;
        }

        // 宛先を抽出（Advanced Gmail API使用）
        var recipients = extractRecipients(message);

        if (recipients.length === 0) {
          Logger.log('  宛先が見つかりません: ' + trackingId);
          continue;
        }

        Logger.log('  宛先: ' + recipients.join(', '));

        // パスワード通知メールを送信
        sendPasswordNotification(recipients, logEntry.passwords, logEntry.files);

        // ログを更新（ホワイトリストも保存）
        updateLogEntry(trackingId, {
          recipients: recipients,
          whitelist: recipients,  // ホワイトリストとして保存
          sentMsgId: message.getId(),
          status: 'PASSWORD_SENT'
        });

        // 処理済みラベルを付与
        thread.addLabel(pwSentLabel);

        processedCount++;
        Logger.log('  ✓ パスワード送信完了: ' + trackingId);
      }
    }

    Logger.log('=== パスワード送信完了: ' + processedCount + ' 件 ===');

  } catch (e) {
    Logger.log('=== パスワード送信エラー: ' + e.message + ' ===');
    throw e;
  }
}

/**
 * 本文から追跡IDを抽出
 */
function extractTrackingId(body) {
  var pattern = SYS.TRACKING.PATTERN;
  var match = body.match(pattern);

  if (match && match[1]) {
    return SYS.TRACKING.PREFIX + match[1];
  }

  return null;
}

/**
 * メッセージから宛先（To, Cc, Bcc）を抽出
 * Advanced Gmail APIを使用（送信済みメールのBccも取得可能）
 */
function extractRecipients(message) {
  try {
    var messageId = message.getId();

    // Advanced Gmail APIで詳細を取得
    var gmailMessage = Gmail.Users.Messages.get('me', messageId, {
      format: 'full'
    });

    var headers = gmailMessage.payload.headers;
    var recipients = [];

    // To, Cc, Bcc ヘッダーを抽出
    for (var i = 0; i < headers.length; i++) {
      var header = headers[i];
      if (header.name === 'To' || header.name === 'Cc' || header.name === 'Bcc') {
        var addresses = parseEmailAddresses(header.value);
        recipients = recipients.concat(addresses);
      }
    }

    // 重複除去
    var unique = [];
    var seen = {};
    for (var i = 0; i < recipients.length; i++) {
      var addr = recipients[i].toLowerCase();
      if (!seen[addr]) {
        unique.push(recipients[i]);
        seen[addr] = true;
      }
    }

    // トリガーアドレスを除外
    var filtered = [];
    for (var i = 0; i < unique.length; i++) {
      if (unique[i].toLowerCase().indexOf(SYS.TRIGGER_EMAIL.toLowerCase()) === -1) {
        filtered.push(unique[i]);
      }
    }

    return filtered;

  } catch (e) {
    Logger.log('宛先抽出エラー: ' + e.message);
    return [];
  }
}

/**
 * メールアドレス文字列をパース
 * 例: "Name <email@example.com>, another@example.com" → ["email@example.com", "another@example.com"]
 */
function parseEmailAddresses(addressString) {
  if (!addressString) return [];

  var addresses = [];
  var parts = addressString.split(',');

  for (var i = 0; i < parts.length; i++) {
    var part = parts[i].trim();

    // <email@example.com> 形式
    var match = part.match(/<([^>]+)>/);
    if (match) {
      addresses.push(match[1].trim());
    } else {
      // email@example.com 形式
      var emailMatch = part.match(/([a-zA-Z0-9._+-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/);
      if (emailMatch) {
        addresses.push(emailMatch[1].trim());
      }
    }
  }

  return addresses;
}

/**
 * パスワード通知メールを送信
 */
function sendPasswordNotification(recipients, passwords, files) {
  try {
    // 件名を作成（ファイル名を列挙）
    var fileNames = Object.keys(passwords);
    var subjectFiles = fileNames.length > 1 ?
      fileNames[0] + ' 他' + (fileNames.length - 1) + '件' :
      fileNames[0];

    var subject = SYS.MAIL.PASSWORD_SUBJECT_PREFIX + subjectFiles;

    // 本文を作成
    var body = '暗号化ファイルのパスワードをお送りします。\n\n';
    body += '先ほど送信したメールに記載されているリンクからファイルをダウンロードし、\n';
    body += '以下のパスワードを使用して復号してください。\n\n';
    body += '--- パスワード ---\n';

    for (var i = 0; i < fileNames.length; i++) {
      var fileName = fileNames[i];
      var password = passwords[fileName];
      body += '■ ' + fileName + '\n';
      body += '   パスワード: ' + password + '\n\n';
    }

    body += '--- 注意事項 ---\n';
    body += '・' + SYS.MAIL.PASSWORD_VALIDITY_TEXT + '\n';
    body += '・このパスワードは安全に保管してください。\n';
    body += '・パスワードを第三者に転送しないでください。\n';
    body += '・このメールは自動送信されています。\n\n';
    body += '---\n';
    body += 'NHP SecureLocker\n';

    // 宛先ごとにメール送信
    for (var i = 0; i < recipients.length; i++) {
      var recipient = recipients[i];

      try {
        GmailApp.sendEmail(recipient, subject, body, {
          name: Session.getActiveUser().getEmail()  // 送信者名義
        });

        Logger.log('  → ' + recipient + ' に送信');

      } catch (e) {
        Logger.log('  ✗ ' + recipient + ' への送信失敗: ' + e.message);
        // 個別の失敗は記録するが処理は続行
      }
    }

  } catch (e) {
    Logger.log('パスワード通知送信エラー: ' + e.message);
    throw e;
  }
}

/**
 * テスト: 追跡ID抽出
 */
function testExtractTrackingId() {
  Logger.log('=== 追跡ID抽出テスト ===');

  var testBodies = [
    'これはテスト本文です。\n\n[#ANGO-ABC12345]',
    'ファイル: https://drive.google.com/file/d/xxxxx\n\n[#ANGO-XYZ98765]',
    '追跡IDなし',
    '[#ANGO-]'  // 不正な形式
  ];

  for (var i = 0; i < testBodies.length; i++) {
    var body = testBodies[i];
    var trackingId = extractTrackingId(body);
    Logger.log((i + 1) + ': ' + (trackingId || '(null)'));
  }

  Logger.log('=== テスト完了 ===');
}

/**
 * テスト: メールアドレスパース
 */
function testParseEmailAddresses() {
  Logger.log('=== メールアドレスパース テスト ===');

  var testStrings = [
    'user@example.com',
    'Name <user@example.com>',
    'user1@example.com, user2@example.com',
    'Name1 <user1@example.com>, Name2 <user2@example.com>',
    'user@example.com, Name <another@example.com>'
  ];

  for (var i = 0; i < testStrings.length; i++) {
    var str = testStrings[i];
    var addresses = parseEmailAddresses(str);
    Logger.log((i + 1) + ': ' + str);
    Logger.log('   → ' + JSON.stringify(addresses));
  }

  Logger.log('=== テスト完了 ===');
}
