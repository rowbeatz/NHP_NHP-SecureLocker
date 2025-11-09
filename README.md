# NHP SecureLocker (NHP AI セキュアLocker システム)

Google Workspace（GAS + Drive/Sheets）だけで実装した、**添付ファイルやDriveファイルを自動暗号化して共有リンク化**し、**操作ログを永続保存**する社内向けユーティリティです。
依存サービスは**Google標準**のみ。サーバー不要・運用コスト極小。“小回りが利く金庫番”をイメージしてください。

> ✅ 2025-11-09 時点の実装状況（v0.9）
>
> * **実装済み**：ファイル暗号化（AES-256-CBC）、HKDF/PBKDF2派生、暗号ファイルのDrive保存&リンク共有、Sheetsログ保存、ドライラン一式
> * **次段計画**：Gmail BCC 連携 → トラッキング番号付きドラフト生成 → 受信後に**パスワード自動送信** → 15日後の**自動削除**（タイマー駆動）

---

## TL;DR（最短セットアップ）

1. GAS プロジェクトを開き、**3ファイル**を作成してコードを貼る

   * `Code.gs`（コア）
   * `TestHarness.gs`（テスト用ランナー）
   * `cryptojs_min.gs`（CryptoJS最小バンドル：core/base64/sha256/hmac-sha256/pbkdf2/cipher-core/mode-cbc/pad-pkcs7/aes）
2. **Drive API（高度なGoogleサービス）= 有効化**、**Google Drive API（GCP側）= 有効化**
3. 共有ドライブに `SecureLocker/Encrypted` と `SecureLocker/Logs` を作成（IDを控える）
4. ログ用スプレッドシートを1つ作成（`Logs` シートを自動作成します。ファイルIDだけ控える）
5. スクリプトプロパティを設定（ID類・システム名・KDFモード等）
6. メニューから `runSanityCheck()` → `runSelfTest()` を実行
7. 動けばOK。`Encrypted` に `.enc` ファイルができ、リンク共有が有効になっていれば正常。

---

## 1. 何ができるの？

* **Drive上の任意ファイルを暗号化**し、`.enc` テキスト（OpenSSL風ではなく独自ヘッダ）にして保存
* 暗号ファイルに **“リンクを知っている全員に閲覧権限”** を自動付与（安全運用の前提は**別送のパスワード**）
* 暗号処理の**操作ログをSheetsに永続化**（監査・トレーサビリティ）
* 暗号パラメータ：AES-256-CBC + **HKDF-SHA256（既定）** もしくは PBKDF2-SHA256（高反復）
* 乱数は `CryptoJS.lib.WordArray.random` に頼らず **GASネイティブ＋HMACで生成**（Apps Script互換）

> 将来拡張（計画）
>
> * Gmail BCC 受信 → 自動で**パスワード通知**メール送信
> * 暗号化済みファイルの **TTL超過自動削除**（時間主導トリガ）

---

## 2. セキュリティ仕様（概要）

* **暗号化方式**：AES-256-CBC（`CryptoJS.algo.AES` 低レベルAPIを直叩き）
* **鍵導出**：

  * 既定 `KDF_MODE=FAST` → **HKDF-SHA256**（擬似乱数PW＋Saltから64B導出→上位32BをAES鍵）
  * `KDF_MODE=PBKDF2` → **PBKDF2-SHA256**（反復回数=`KDF_ITERATIONS`、既定60,000）
* **IV**：16B ランダム（GAS + HMAC混合生成）
* **ヘッダ形式**：

  ```
  SL1:<saltHex>:<ivHex>:<base64(cipher)>
  ```
* **パスワード**：既定 **24文字**（英大小・数字・記号を必ず全種含む）
* **共有**：暗号ファイルは「リンクを知っている全員／閲覧」へ自動設定
* **ログ**：

  * Drive内 `Logs` フォルダに日次ファイル（ベストエフォート、詳細は「既知の事象」を参照）
  * Sheets: `Logs` シートに確定記録（**監査の正本**）

---

## 3. プロジェクト構成

```
/ (Apps Script プロジェクト)
├── Code.gs            # コア：暗号化・Drive保存・共有・Sheetsログ
├── TestHarness.gs     # 動作確認用ランナー（URL/ID/フォルダで試験）
└── cryptojs_min.gs    # CryptoJS最小バンドル（※必須：後述ガイドに従い用意）
```

> **cryptojs_min.gs について**
> Node用の `require()` や `module.exports` は **入れない**でください。
> 含めるモジュール（順序厳守）：`core` → `enc-base64` → `sha256` → `hmac-sha256` → `pbkdf2` → `cipher-core` → `mode-cbc` → `pad-pkcs7` → `aes`。
> 既にお持ちのミニファイルがあれば、その**中身まるごと**を `.gs` に貼付してOK。

---

## 4. 事前準備

### 4.1 共有ドライブとフォルダ

1. 共有ドライブを選定（例：`ドライブ`）
2. その直下に `SecureLocker/Encrypted` と `SecureLocker/Logs` フォルダを作成
3. それぞれの **フォルダID** をメモ（URL `.../folders/<ID>` の `<ID>` 部分）

### 4.2 スプレッドシート

* システム用スプレッドシートを新規作成（※空でOK）
* **ファイルID** をメモ（URL `.../d/<ID>/edit` の `<ID>` 部分）

### 4.3 Apps Script 設定

* エディタを開いて3ファイルを作成し、**完全貼り付け**（差分ではなく全置換）
* **[サービス] → 高度なGoogleサービス**

  * **Drive API** を **ON**（バージョン v2）
* **GCPコンソール**（[プロジェクトを表示]→リンク）

  * **Google Drive API** を **有効化**

---

## 5. スクリプトプロパティ（環境変数）

`設定 > プロジェクトのプロパティ > スクリプトのプロパティ` に以下を登録：

| KEY                       | 推奨値/例                    | 説明                           |
| ------------------------- | ------------------------ | ---------------------------- |
| `SYSTEM_EMAIL`            | `y-furusawa+ango@nhp.jp` | システム名義（将来Gmail送信で使用）         |
| `SYSTEM_NAME_JP`          | `NHP AI セキュアLocker システム` | 表示名（日）                       |
| `SYSTEM_NAME_EN`          | `NHP SecureLocker`       | 表示名（英）                       |
| `SHARED_DRIVE_ID`         | `xxxxxxxxxxxxxxxxxxxx`   | 共有ドライブID                     |
| `FOLDER_ENCRYPTED_ID`     | `xxxxxxxxxxxxxxxxxxxx`   | `SecureLocker/Encrypted` のID |
| `FOLDER_LOGS_ID`          | `xxxxxxxxxxxxxxxxxxxx`   | `SecureLocker/Logs` のID      |
| `SHEET_ID`                | `xxxxxxxxxxxxxxxxxxxx`   | 監査ロガー用シートID                  |
| `DEFAULT_EXPIRY_DAYS`     | `14`                     | 有効期限（表示用）                    |
| `DELETE_AFTER_DAYS`       | `15`                     | 自動削除予定日（表示用、将来の削除ジョブで使用）     |
| `PW_LEN`                  | `24`                     | 生成PWの長さ                      |
| `PW_SYMBOLS`              | `!@#$%^&*()-_=+[]{}:,.?` | 使用する記号                       |
| `OTP_REQUIRED`            | `true`                   | 将来OTP連携のトグル                  |
| `OTP_CODE_LENGTH`         | `6`                      | 将来OTP桁数                      |
| `OTP_TTL_MIN`             | `10`                     | 将来OTP有効分数                    |
| `OTP_RESEND_COOLDOWN_SEC` | `30`                     | 将来OTP再送制限                    |
| `OTP_MAX_ISSUE_PER_30MIN` | `5`                      | 将来OTP発行制限                    |
| `OTP_MAX_VERIFY_ATTEMPTS` | `5`                      | 将来OTP検証上限                    |
| `OTP_LOCK_MIN`            | `10`                     | 将来OTPロック分数                   |
| `SECRET_HMAC`             | ランダム長文字列                 | HMACシード（**必ず設定**）            |
| `KDF_MODE`                | `FAST` or `PBKDF2`       | 既定は `FAST`（HKDF）             |
| `KDF_ITERATIONS`          | `60000`                  | `PBKDF2` の反復回数               |

> **セキュリティTIP**：`SECRET_HMAC` は**長めのランダム**を推奨。万一漏れても**都度ローテーション**しやすい運用に。

---

## 6. 使い方（運用手順）

### 6.1 動作確認（ドライラン）

* `runSanityCheck()`：フォルダ/シート参照とHMAC計算の健全性チェック
* `runSelfTest()`：小さなテキストを暗号化し、`Encrypted` に `.enc` を作成 → 共有ON → Sheetsにログ

### 6.2 実ファイルでテスト

* `TestHarness.gs` の先頭に **URL/ID/フォルダID** をセット

  * `runDryRunByUrl()`：共有可能リンク1本で試験
  * `runDryRunByFileId()`：ファイルID指定で試験
  * `runDryRunByFolderId()`：フォルダ内先頭の非フォルダファイルで試験
* 正常時はログに `OK: { ... link, outId, passwordRef ... }` が出力され、`Encrypted` に `.enc` が作成されます

### 6.3 パスワードの扱い（現行）

* 現行のドライランは**パスワードを別送しません**（内部で生成 → ログには**マスク済み**で一部のみ記録）
* 社外送付時は、**別チャンネル（電話/Slack DM/SMS 等）でPWを通知**してください
* 次段で **BCC受信 → 自動PW送信** を実装予定

---

## 7. 典型ユースケース（想定運用フロー）

#### Case-A: 社外へ機微なPDFを送る

1. ドラフト段階でPDFをDriveへ格納（共有は**オフ**のまま）
2. 管理者が `runDryRunByFileId()` を実行して `.enc` と共有リンクを取得
3. 送信メール本文に**共有リンク**を挿入し、PWは別チャンネルで通知
4. 14日以内のダウンロードを依頼（15日後に削除される旨も伝達）

   > 削除は次段の自動化対象。現行は手動運用 or 補助スクリプトで実施

#### Case-B: Googleドキュメント/スプレッドシートを暗号化

* 本システムは**自動エクスポート**して暗号化します

  * ドキュメント → **PDF**
  * スプレッドシート → **XLSX**
  * スライド → **PDF**
* その後の流れはCase-Aと同様

---

## 8. 監査ログ（Sheets / Drive）

* **Sheets**（`SHEET_ID`）：

  * シート名 `Logs`（自動作成）
  * 項目：`timestamp, action, srcId, srcName, outId, outName, link, expiresAt, deleteAfter, passwordRef, note`
  * **削除禁止**（規定）
* **Drive/Logs**：

  * `securelocker-YYYYMMDD.log` に追記（ベストエフォート）
  * Apps Scriptの制約で**追記に失敗する場合があり**、その際はログに
    `LOG ERR: file.appendChunk is not a function` と出ます（**致命ではありません**。Sheets側が正本）

> **（任意）Driveログの追記を安定化したい場合**：
> `Code.gs` の `logLine_()` を **「読み出し→文字列連結→`setContent`」方式**に置き換える運用が最も互換性が高いです（巨大化に注意）。

---

## 9. 暗号ファイル仕様（復号のヒント）

* 形式：`SL1:<saltHex>:<ivHex>:<base64(cipher)>`
* 鍵導出：

  * `FAST` → HKDF-SHA256(salt, info="NHP-SecureLocker") で 64B 抽出 → 上位32BをAES鍵
  * `PBKDF2` → PBKDF2-SHA256(password, salt, iterations=KDF_ITERATIONS) → 32B鍵＆16B IV（※本実装ではIVはHKDF生成。PBKDF2時は鍵64Bを生成し上位/下位で鍵/IVを切り出すなど、将来復号ツールと合わせます）
* 復号ツール：Node/Python/OpenSSL相当を**社内CLI**として後日同梱予定

---

## 10. エラー/トラブルシュート

| 症状                                                                     | 原因/対処                                                                |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `fileId が必要です`                                                         | `runDryRunByFileId()` 実行時にID未設定。`TEST_FILE_ID` を入れてください。             |
| `DriveのURLから fileId を抽出できません`                                          | 共有リンク形式が未対応・コピペ漏れ。`.../d/<ID>/view...` か `...?id=<ID>` 形式で。          |
| `Converting from application/vnd.google-apps.script ... not supported` | Apps Scriptファイル等はエクスポート不可。通常ファイルかGoogleドキュメント/スプレッドシート/スライドで。        |
| `We're sorry, a server error occurred.`                                | Driveの**一時エラー**。本体は**指数バックオフ**付き再試行を内蔵していますが、継続する場合は数分後に再実行。         |
| `LOG ERR: file.appendChunk is not a function`                          | Driveログ追記が失敗（仕様差分）。**無視可**。Sheetsログが正本。安定化したい場合は `setContent` 方式に変更。 |
| `Cannot read properties of undefined (reading 'create')`               | CryptoJS のHelper経由バグ。**本実装は低レベルAPI直叩き**で回避済み。                        |
| `WordArray.random is not a function`                                   | Apps Scriptで `CryptoJS.lib.WordArray.random` が不定。**独自RNG**利用に切替済み。   |

---

## 11. 権限とセキュリティ運用

* スクリプトは **実行ユーザーの権限**で Drive/Sheets にアクセスします
* `Encrypted` フォルダは**限定運用**（アクセス最小化）。リンク共有は**ファイル単位**でON
* `SECRET_HMAC` は**機微**。閲覧者を絞り、**定期ローテーション**を推奨
* ログ（Sheets/Drive）は**監査の正本**として保持・改ざん防止（編集権限の最小化）

---

## 12. 削除ポリシー（将来の自動化）

* ログに `deleteAfter`（ISO8601）を残しています
* **次段**で時間主導トリガー（例：日次）を用意し、`deleteAfter` 経過ファイルを自動削除予定
* 現行は**手動運用**または簡易バッチ（後述サンプル）で代替

#### （参考）簡易バッチ例（将来の `Cleanup.gs`）

```javascript
function cleanupExpiredEncryptedFiles(){
  var ss = SpreadsheetApp.openById(SYS.SHEET_ID);
  var sh = ss.getSheetByName("Logs"); if(!sh) return;
  var values = sh.getDataRange().getValues(); if(values.length <= 1) return;
  var now = new Date();
  var header = values[0];
  var idxOutId = header.indexOf("outId");
  var idxDelete = header.indexOf("deleteAfter");

  for(var i=1;i<values.length;i++){
    var outId = values[i][idxOutId], delAt = values[i][idxDelete];
    if(!outId || !delAt) continue;
    var when = new Date(delAt);
    if(when <= now){
      try{ Drive.Files.trash(outId, {supportsTeamDrives:true,supportsAllDrives:true}); }
      catch(e){ Logger.log("CLEANUP WARN: "+outId+" "+e); }
    }
  }
}
```

---

## 13. 実装メモ（技術詳細）

* 暗号は **ヘルパー（`CryptoJS.AES.encrypt`）を使わず**、`CryptoJS.algo.AES.createEncryptor` を直叩き

  * GASにおけるCryptoJSの**ローディング順依存/未定義化**に強く、将来の`cryptojs_min`差し替えにも堅牢
* Google系MIME（Docs/Sheets/Slides）は**自動エクスポート**してから暗号化
* Drive API には **v2** を利用（Apps Scriptの高度なサービスに整合）

---

## 14. よくある質問（FAQ）

**Q. 暗号ファイルはどうやって復号するの？**
A. 現行は**送信側の責務**。後日、Node/PythonのCLIを同梱予定です。仕様は本READMEの「暗号ファイル仕様」を参照。

**Q. パスワードはどこに保存される？**
A. **平文保存はしません**。Sheetsの `passwordRef` はHMACでの参照用（平文復元不可）。運用は**別送**が前提。

**Q. 既存のS/MIMEやPPSX送付と何が違う？**
A. GoogleドライブとGASのみで閉じ、**展開コストが極小**、監査と削除の**運用が一体化**している点が強みです。

---

## 15. 変更管理（推奨）

* `SHEET_ID` とは別に **Changelogシート**を用意し、日付・対応者・変更点・影響範囲を記録
* `SECRET_HMAC` ローテーションや `KDF_MODE` 変更は**必ずChangelogに残す**
* バージョンタグ例：`v0.9 (2025-11-09)`：HKDF-FAST既定、Gmail/BCC未実装、手動削除運用

---

## 16. 次の一歩（実装ロードマップ）

* **Gmail 連携**

  * システムアドレス（例：`y-furusawa+ango@nhp.jp`）宛メールのBCC受付
  * 本文末尾にトラッキングIDを付与して**ドラフト再保存**
  * 受信時に対象リンクを検出 → **パスワード自動送信**（To/CC/Bcc に一括）
* **自動削除**（日次トリガ）

  * `deleteAfter` 経過ファイルのDrive削除＆Sheetsに削除ログ
* **復号CLI** の配布（Windows/Mac/Linux）

---

## 17. ライセンス/クレジット

* 暗号ライブラリ：**CryptoJS (MIT)**
* 本システム：社内用途（NHP内）向けの業務ツール

---

## 付録A：動作確認コマンド一覧（スクリプトエディタから実行）

* `runSanityCheck()` … 共有フォルダ/シート参照チェック
* `runSelfTest()` … 小ファイル暗号化 → `.enc` 作成 → 共有ON → Sheetsログ
* `runDryRunByUrl()` … `TestHarness` でURL指定して暗号化
* `runDryRunByFileId()` … `TestHarness` でファイルID指定
* `runDryRunByFolderId()` … `TestHarness` でフォルダ内先頭ファイルを暗号化

---

## 付録B：既知の事象（無害）

* ログ出力時に `LOG ERR: file.appendChunk is not a function` が表示される場合があります。
  → **Sheetsの記録は成功**しているため、通常は無視可。Driveログも必要なら `setContent` 方式へ置換してください。

---

