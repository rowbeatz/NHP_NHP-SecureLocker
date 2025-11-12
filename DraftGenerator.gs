/**
 * DraftGenerator.gs - ドラフト生成
 * Advanced Gmail APIを使用して同スレッドにドラフトを作成
 */

/**
 * スレッド内にドラフトを作成
 * @param {GmailThread} thread - 元のスレッド
 * @param {string} subject - 件名
 * @param {string} body - 本文
 * @param {string} trackingId - 追跡ID
 * @param {Array} files - ファイル情報
 *
 * 重複防止対策:
 * 1. 既存ドラフトに追跡IDが含まれているかチェック
 * 2. 既存の場合は新規作成をスキップ
 */
function createDraftInThread(thread, subject, body, trackingId, files) {
  try {
    Logger.log('--- ドラフト作成開始 ---');

    // ★ 既存ドラフトをチェック（重複防止）
    var existingDrafts = thread.getDrafts();
    Logger.log('既存ドラフト数: ' + existingDrafts.length);

    for (var i = 0; i < existingDrafts.length; i++) {
      var draft = existingDrafts[i];
      var draftMessage = draft.getMessage();
      var draftBody = draftMessage.getBody();

      // 追跡IDが本文に含まれている場合、既にドラフト作成済み
      if (draftBody.indexOf(trackingId) !== -1) {
        var existingDraftId = draft.getId();
        Logger.log('⚠ 既存ドラフト検出: ' + existingDraftId + ' (追跡ID: ' + trackingId + ')');
        Logger.log('✓ ドラフト作成スキップ（重複防止）');

        // 既存のドラフトIDを返す
        return existingDraftId;
      }
    }

    Logger.log('既存ドラフトなし。新規作成します。');

    var userEmail = Session.getActiveUser().getEmail();
    var threadId = thread.getId();

    // BCC設定: 送信者自身 + トリガーアドレス
    var bccList = [userEmail, SYS.TRIGGER_EMAIL];

    // メールヘッダーとボディを構成
    var rawMessage = createRawMessage({
      to: '',  // ユーザーが手動で入力
      cc: '',
      bcc: bccList.join(','),
      subject: subject,
      body: body,
      threadId: threadId
    });

    // Advanced Gmail APIでドラフト作成
    var draft = Gmail.Users.Drafts.create(
      {
        message: {
          raw: rawMessage,
          threadId: threadId
        }
      },
      'me'
    );

    var draftId = draft.id;
    Logger.log('✓ ドラフト作成完了: ' + draftId);

    // ログを更新
    updateLogEntry(trackingId, {
      draftId: draftId,
      status: 'DRAFT_CREATED'
    });

    // ラベルを付与
    var label = getOrCreateLabel(SYS.LABELS.DRAFT_CREATED);
    thread.addLabel(label);

    return draftId;

  } catch (e) {
    Logger.log('✗ ドラフト作成エラー: ' + e.message);
    throw e;
  }
}

/**
 * RFC 2822形式のRawメッセージを作成
 * Base64url エンコード
 */
function createRawMessage(params) {
  var lines = [];

  // ヘッダー
  if (params.to) lines.push('To: ' + params.to);
  if (params.cc) lines.push('Cc: ' + params.cc);
  if (params.bcc) lines.push('Bcc: ' + params.bcc);

  // 件名をMIME encoded-word形式でエンコード（UTF-8）
  var encodedSubject = encodeMimeWord(params.subject);
  lines.push('Subject: ' + encodedSubject);

  lines.push('Content-Type: text/html; charset=UTF-8');
  lines.push('Content-Transfer-Encoding: base64');

  // スレッド情報（In-Reply-To, References）
  // 注: threadIdを指定すればGmail APIが自動で処理するため省略可能

  // 空行（ヘッダーとボディの区切り）
  lines.push('');

  // ボディ（Base64エンコード）
  var bodyEncoded = Utilities.base64Encode(params.body, Utilities.Charset.UTF_8);
  lines.push(bodyEncoded);

  var email = lines.join('\r\n');

  // Base64url エンコード（Gmail APIの要件）
  var base64 = Utilities.base64EncodeWebSafe(email);

  return base64;
}

/**
 * MIME encoded-word形式でエンコード（RFC 2047）
 * 日本語などの非ASCII文字を含む件名を正しくエンコード
 * 形式: =?UTF-8?B?<Base64エンコードされた文字列>?=
 */
function encodeMimeWord(text) {
  // ASCII文字のみの場合はそのまま返す
  if (/^[\x00-\x7F]*$/.test(text)) {
    return text;
  }

  // UTF-8でエンコードしてBase64化
  var encoded = Utilities.base64Encode(text, Utilities.Charset.UTF_8);

  // RFC 2047形式で返す
  // 1行は75文字以内に収める必要があるが、Gmail APIが自動的に処理するため
  // ここでは簡易的に全体をエンコード
  return '=?UTF-8?B?' + encoded + '?=';
}

/**
 * ドラフトのテスト
 */
function testCreateDraft() {
  Logger.log('=== ドラフト作成テスト ===');

  // テスト用のスレッドを検索（最新のメール）
  var threads = GmailApp.search('to:' + SYS.TRIGGER_EMAIL, 0, 1);

  if (threads.length === 0) {
    Logger.log('✗ テスト用のスレッドが見つかりません');
    return;
  }

  var thread = threads[0];
  var trackingId = generateTrackingId();

  var testBody = 'これはテストドラフトです。\n\n' +
                 '暗号化ファイル:\n' +
                 '・test.pdf: https://drive.google.com/file/d/xxxxx\n\n' +
                 '[#' + trackingId + ']';

  // ドラフト作成（ログエントリーがないため、updateLogEntryはスキップされる）
  try {
    var draftId = createDraftInThread(
      thread,
      'テスト: 暗号化ファイル送信',
      testBody,
      trackingId,
      []
    );

    Logger.log('✓ テスト成功: ' + draftId);
  } catch (e) {
    Logger.log('✗ テスト失敗: ' + e.message);
  }

  Logger.log('=== テスト完了 ===');
}
