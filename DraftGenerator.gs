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
 */
function createDraftInThread(thread, subject, body, trackingId, files) {
  try {
    Logger.log('--- ドラフト作成開始 ---');

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
  lines.push('Subject: ' + params.subject);
  lines.push('Content-Type: text/plain; charset=UTF-8');
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
