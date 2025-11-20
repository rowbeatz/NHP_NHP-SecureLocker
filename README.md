# NHP SecureLocker - セットアップガイド

Google Apps Script (GAS) による暗号化メール送信システム

**バージョン: v1.2 最新版**
**最終更新: 2025-11-12**

---

## 概要

NHP SecureLocker は、Google Workspace 上で動作する暗号化ファイル送信システムです。

### 主な機能

1. **自動暗号化**: メール添付ファイルやDriveリンクを自動的にAES-256で暗号化
2. **ドラフト生成**: 暗号化後のリンクを含むドラフトを同スレッドに自動作成
3. **パスワード自動送信**: 送信後、宛先全員（To/Cc/Bcc）にパスワードを自動通知
4. **自動削除**: 14日有効期限、15日後に暗号化ファイルを自動削除
5. **完全ログ**: Spreadsheetにすべての操作を記録

### セキュリティ

- **暗号化**: AES-256-CBC + HMAC-SHA256 (Encrypt-then-MAC)
- **鍵導出**: PBKDF2-SHA256 (100,000 iterations)
- **パスワード**: 24桁ランダム生成（英大小数字記号混在、先頭末尾は英数字のみ）

---

## 技術仕様詳細

### 暗号化ファイル形式

**ファイル拡張子**: `.yenc`（NHP SecureLocker専用形式）

**パッケージ構造**:
```
[JSON Header]
---
[Base64 Ciphertext]
```

**ヘッダー内容（JSON）**:
```json
{
  "version": "1.0",
  "algorithm": "AES-256-CBC",
  "kdf": "PBKDF2",
  "kdfIter": 100000,
  "kdfSaltB64": "...",      // 16バイトのSalt（Base64）
  "ivB64": "...",            // 16バイトのIV（Base64）
  "macB64": "...",           // HMAC-SHA256（Base64）
  "originalName": "...",     // 元のファイル名
  "mimeType": "...",         // MIMEタイプ
  "sizeBytes": 123456,       // 元のファイルサイズ
  "createdAt": "2025-11-09T12:34:56.789Z"
}
```

### 暗号化プロセス

1. **鍵導出**:
   ```
   Key = PBKDF2-SHA256(Password, Salt, 100000 iterations, 256 bits)
   ```

2. **暗号化**:
   ```
   Ciphertext = AES-256-CBC.encrypt(Plaintext, Key, IV)
   ```

3. **MAC生成**（Encrypt-then-MAC）:
   ```
   MAC = HMAC-SHA256(Salt || IV || Ciphertext, SECRET_HMAC)
   ```

4. **パッケージング**:
   ```
   Package = JSON(Header) + "\n---\n" + Base64(Ciphertext)
   ```

### 乱数生成

GASの `CryptoJS.lib.WordArray.random` は環境によって不安定なため、独自実装：

```javascript
// GAS UUID + HMAC による安全な乱数生成
seed = UUID + UUID + UUID
random = HMAC-SHA256(seed, SECRET_HMAC)
```

### ファイル名マスキング

暗号化ファイルのファイル名は元のファイル名を隠蔽：
```
元: 重要資料.pdf
↓
暗号化: a1b2c3d4.yenc
```

元のファイル名は **ヘッダーの `originalName` に保存**され、パスワード通知メールに記載されます。

### 復号方法

**現在**: サーバー側関数 `decryptFile()` でテスト可能（Crypto.gs）

**将来**: ブラウザ復号UI（decrypt.html）を統合予定
- Web Crypto API による復号
- パスワード入力 → 即座に復号・ダウンロード
- サーバーへのパスワード送信なし（完全クライアント側処理）

---

## システムフロー

```
[送信者] → securelocker@nhp.jp 宛にメール送信（添付/Driveリンク付き）
   ↓
[processIncomingMails] 1分ごとのトリガーで自動実行
   ↓
[添付/リンク暗号化] → Drive保存 → 追跡ID付与 → ログ記録
   ↓
[クラウドリンク除去] 本文からGoogle Drive、BOX、Dropbox等のリンクを自動削除
   ↓
[ドラフト生成] 同スレッド、Bcc: securelocker@nhp.jp + 送信者（RFC 2047 MIME件名エンコード）
   ↓
[送信者] To/Cc追加 → 手動送信
   ↓
[processSentMailsForPassword] 1分ごとのトリガーで自動実行（送信後30〜60秒で処理）
   ↓
[宛先抽出] 送信済みメールからTo/Cc/Bcc全員を取得
   ↓
[パスワード送信] 全員に24桁PWを自動通知
   ↓
[受信者] リンク→ダウンロード→復号（パスワード入力）
   ↓
[sweepExpiredFiles] 毎日午前2時に自動実行
   ↓
[15日経過ファイル削除] ゴミ箱 or 完全削除
```

---

## セットアップ手順

### 1. 前提条件

- Google Workspace アカウント（nhp.jp ドメイン）
- 共有ドライブへのアクセス権限
- Google Apps Script プロジェクトの作成権限

### 2. 共有ドライブIDの取得

1. Google Driveで共有ドライブを開く
2. URLから共有ドライブIDを取得
   ```
   例: https://drive.google.com/drive/folders/0APbz-T9cPss3Uk9PVA
   → ID: 0APbz-T9cPss3Uk9PVA
   ```

### 3. Script Propertiesの設定

1. GASエディタで「プロジェクトの設定」→「スクリプト プロパティ」を開く
2. 以下のプロパティを追加:

   | キー | 値（例） | 説明 |
   |------|---------|------|
   | `SHARED_DRIVE_ID` | `0APbz-T9cPss3Uk9PVA` | 共有ドライブID（**必須**） |

   ※他のプロパティ（FOLDER_ENCRYPTED_ID等）はbootstrap実行時に自動生成されます

### 4. Advanced Servicesの有効化

1. GASエディタで「サービス」を開く
2. 以下を追加:
   - **Drive API (v2)** ✓
   - **Gmail API (v1)** ✓

### 5. Bootstrap実行（初回のみ）

1. GASエディタで関数 `bootstrapSecureLocker()` を実行
2. 権限承認が求められたら許可
3. 実行ログで以下を確認:
   ```
   FOLDER_ENCRYPTED_ID => 1ABC...
   FOLDER_LOGS_ID => 1XYZ...
   SECRET_HMAC（生成）
   Done.
   ```

4. Script Propertiesを確認（以下が自動追加されている）:
   - `FOLDER_ENCRYPTED_ID` - 暗号化ファイル保存先
   - `FOLDER_LOGS_ID` - ログフォルダ
   - `SECRET_HMAC` - HMAC秘密鍵

### 6. ログSpreadsheetの初期化

1. 関数 `initLogSpreadsheet()` を実行（Logger.gs）
2. 実行ログでSpreadsheet URLを確認
3. `LOG_SPREADSHEET_ID` がScript Propertiesに自動保存される

### 7. トリガーのセットアップ

1. 関数 `setupAllTriggers()` を実行（Triggers.gs）
2. 以下のトリガーが作成されます:
   - **メール処理**: 1分ごと（processIncomingMails）
   - **パスワード送信**: 1分ごと（processSentMailsForPassword）
   - **期限切れ削除**: 毎日午前2時（sweepExpiredFiles）

3. トリガー確認: 関数 `listAllTriggers()` で一覧表示

**注意**: 1分間隔のトリガーにより、メール送信後30〜60秒以内に自動処理が開始されます。

### 8. 設定検証

関数 `validateConfig()` を実行

すべて✓であればセットアップ完了です。

---

## 使い方

### 送信者（暗号化ファイルを送りたい人）

#### 1. メール作成と送信

```
宛先: securelocker@nhp.jp
件名: （自由）
本文: （実際に送りたい内容）
添付: 暗号化したいファイル、またはDriveリンク
```

送信後、**1分以内**（通常30〜60秒）に自動処理が開始されます。

**重要**: 本文にGoogle Drive、BOX、Dropbox、OneDrive等のクラウドストレージリンクが含まれている場合、それらは自動的に削除されます（暗号化されたファイルリンクのみが残ります）。

#### 2. ドラフト確認

Gmailのドラフトに以下の内容で自動生成されます:

- 本文の添付/リンクが暗号化Driveリンクに差し替え
- 本文末に追跡ID `[#ANGO-XXXXXXXX]` が付与
- Bcc: `securelocker@nhp.jp, 送信者自身`

#### 3. 宛先追加と送信

- To/Ccに実際の送信先アドレスを入力
- そのまま送信

#### 4. パスワード自動送信

送信後**1分以内**（通常30〜60秒）に、To/Cc/Bccの全員にパスワード通知メールが自動送信されます。

**パスワード通知メールの内容:**
```
件名: 【パスワード送付】ファイル名.pdf

本文:
暗号化ファイルのパスワードをお送りします。

--- パスワード ---
■ ファイル名.pdf
   パスワード: Abc123!@#XyzAbcDef1234567

--- 注意事項 ---
・有効期限: 14日
・このパスワードは安全に保管してください。
```

### 受信者（暗号化ファイルを受け取った人）

#### 1. メール受信

本文に暗号化ファイルのDriveリンクが記載されています。

#### 2. パスワード受信

別途パスワード通知メールが届きます。

#### 3. ファイルダウンロード

Driveリンクをクリックして `.yenc` ファイルをダウンロード。

#### 4. 復号（DecryptUI.html を使用）

**推奨**: ブラウザ復号UI（DecryptUI.html）を使用

1. **DecryptUI.html を開く**
   - ローカルに保存してブラウザで開く
   - または、ホスティングして受信者に URL を共有

2. **ファイル選択**
   - ダウンロードした `.yenc` ファイルを選択
   - ファイル情報（元のファイル名、サイズ、暗号化日時）が自動表示

3. **パスワード入力**
   - パスワード通知メールの24桁パスワードを入力

4. **復号実行**
   - 「復号してダウンロード」ボタンをクリック
   - ブラウザ上で復号され、元のファイル名でダウンロード

**セキュリティ**:
- 完全クライアント側処理（パスワードはサーバーに送信されません）
- CryptoJS 4.1.1（CDN）を使用
- PBKDF2-SHA256 + AES-256-CBC による復号

**代替方法**:
- サーバー側復号関数 `decryptFile()` でテスト可能（Crypto.gs）

---

## テスト

### 暗号化のセルフテスト

```javascript
// Crypto.gs
selfTest_EncryptSmallBlob()
```

テストデータを暗号化→復号して検証します。

### パスワード生成テスト

```javascript
// Crypto.gs
testPasswordGeneration()
```

10個のパスワードを生成し、要件を満たしているか検証します。

### 追跡ID生成テスト

```javascript
// Crypto.gs
testTrackingIdGeneration()
```

### メール処理テスト

実際に `securelocker@nhp.jp` 宛にテストメールを送信してから:

```javascript
// MailProcessor.gs
testProcessIncomingMails()
```

### ログ記録テスト

```javascript
// Logger.gs
testLogger()
```

---

## トラブルシューティング

### エラー: "SHARED_DRIVE_ID が設定されていません"

**解決**: Script Propertiesで `SHARED_DRIVE_ID` を設定後、`bootstrapSecureLocker()` を再実行

### エラー: "Gmail API が利用できません"

**解決**: サービスで Gmail API (v1) を追加

### ドラフトが作成されない

**確認事項**:
1. トリガーが設定されているか（`listAllTriggers()`）
2. 宛先が `securelocker@nhp.jp` か
3. ラベル `es_processed` が付与されていないか

### パスワード通知メールが送信されない

**確認事項**:
1. ドラフトを実際に送信したか
2. Bccに `securelocker@nhp.jp` が含まれているか
3. 追跡ID `[#ANGO-XXXXXXXX]` が本文にあるか
4. ラベル `es_pw_sent` が付与されていないか

---

## 最新アップデート（v1.2）

### パフォーマンス改善
- **高速化**: トリガー間隔を5分→1分に変更
  - メール処理: 最大5分待ち → 最大1分待ち（通常30〜60秒）
  - パスワード送信: 送信後5分以内 → 送信後1分以内

### セキュリティ強化
- **パスワード生成改善**: 先頭と末尾の文字を英数字のみに制限
  - コピー&ペーストエラーを防止
  - 中間22文字は記号を含む強力なパスワードを維持
  - 例: `A1x@#$%Yz!@#$%Abc12345z9`（先頭Aと末尾9は必ず英数字）

### 機能追加
- **クラウドリンク自動削除**: 本文から以下のリンクを自動削除
  - Google Drive: `drive.google.com`, `docs.google.com`
  - BOX: `box.com`, `app.box.com`
  - Dropbox: `dropbox.com`, `dl.dropboxusercontent.com`
  - OneDrive: `onedrive.live.com`, `sharepoint.com`
  - 暗号化ファイルのリンクのみが残ります
  - 他のWebサイトのリンクは保持されます

### UI改善
- **日本語件名対応**: RFC 2047 MIME encoding実装
  - Shift-JIS環境でも文字化けしない
  - UTF-8 Base64エンコードで件名を送信
- **コーポレートカラー対応**: ダウンロードページに企業カラー #0075c1 を適用
  - 背景グラデーション、ボタン、アイコンに統一感
- **ファビコン追加**: NHPロゴ風の鍵アイコンをSVGで実装
  - インラインSVG（data URI）で外部依存なし

---

## ファイル構成

```
NHP-SecureLocker/
├── appsscript.json          # プロジェクト設定（Advanced Services、OAuth Scopes）
├── Config.gs                # システム設定・定数（SYSオブジェクト）
├── Crypto.gs                # 暗号化エンジン（AES-256-CBC、PBKDF2、HMAC）
├── MailProcessor.gs         # メール処理（securelocker@宛検出、添付/リンク暗号化、クラウドリンク除去）
├── DraftGenerator.gs        # ドラフト生成（Advanced Gmail API、RFC 2047 MIME encoding）
├── PasswordNotifier.gs      # パスワード通知（送信済み検出、宛先抽出、自動送信）
├── LifecycleManager.gs      # ライフサイクル管理（15日後自動削除）
├── Logger.gs                # ログ管理（Spreadsheet記録）
├── Triggers.gs              # トリガー管理（1分ごと、毎日午前2時）
├── SystemControl.gs         # システム制御（診断、検証、初期化）
├── bootstrap.gs             # 初期セットアップ（フォルダ作成、HMAC生成）
├── TestHarness.gs           # テストハーネス（ドライラン実行）
├── cryptojs_min.gs          # CryptoJS ライブラリ（AES、PBKDF2、HMAC等）
├── DownloadPage.html        # ダウンロードページUI（パスワード認証、企業カラー #0075c1）★
├── DecryptUI.html           # ブラウザ復号UI（受信者用、完全版）★
├── decrypt.html             # 復号UI（旧版、OTP認証前提）
└── README.md                # このファイル
```

### 各ファイルの詳細

#### **Config.gs** - システム設定
- `SYS` オブジェクト: 全設定を一元管理
- トリガーアドレス、暗号化設定、ライフサイクル設定
- ラベル名、追跡IDパターン、メール設定

#### **Crypto.gs** - 暗号化エンジン
- `generateSecurePassword()` - 24桁パスワード生成（先頭末尾は英数字のみ）
  - Fisher-Yates シャッフルアルゴリズムで中間文字列をランダム化
  - 英大小数字記号をすべて含む（最低1文字ずつ保証）
- `generateTrackingId()` - 追跡ID生成（ANGO-XXXXXXXX）
- `encryptFile()` - AES-256-CBC暗号化
- `decryptFile()` - 復号（テスト用）
- `selfTest_EncryptSmallBlob()` - セルフテスト

#### **MailProcessor.gs** - メール処理
- `processIncomingMails()` - 未処理メール検出（1分ごとトリガー）
- `processMessage()` - 個別メッセージ処理
- `processAttachment()` - 添付ファイル暗号化
- `processDriveLink()` - Driveリンク暗号化
- `extractDriveLinks()` - 本文からリンク抽出
- `removeCloudDriveLinks()` - クラウドストレージリンク自動削除
  - Google Drive、BOX、Dropbox、OneDriveなどのリンクを除去
  - 正規表現パターンマッチングで複数サービスに対応

#### **DraftGenerator.gs** - ドラフト生成
- `createDraftInThread()` - 同スレッドドラフト作成（Advanced Gmail API）
- `createRawMessage()` - RFC 2822形式メッセージ生成
- `encodeMimeWord()` - RFC 2047 MIME encoded-word形式エンコード
  - 日本語件名をUTF-8 Base64でエンコード
  - Shift-JIS環境でも文字化けしない
  - 形式: `=?UTF-8?B?<Base64>?=`
- Bcc自動設定（securelocker@nhp.jp + 送信者）

#### **PasswordNotifier.gs** - パスワード通知
- `processSentMailsForPassword()` - 送信済み検出（1分ごとトリガー）
- `extractTrackingId()` - 本文から追跡ID抽出
- `extractRecipients()` - To/Cc/Bcc全員抽出（Advanced Gmail API）
- `sendPasswordNotification()` - パスワード一斉送信

#### **LifecycleManager.gs** - ライフサイクル管理
- `sweepExpiredFiles()` - 期限切れ削除（毎日午前2時トリガー）
- `deleteFile()` - Drive削除（ゴミ箱 or 完全削除）
- `emergencyDeleteByTrackingId()` - 緊急削除（手動実行用）

#### **Logger.gs** - ログ管理
- `initLogSpreadsheet()` - ログSpreadsheet初期化
- `addLogEntry()` - ログエントリー追加
- `updateLogEntry()` - ログエントリー更新
- `getLogEntry()` - 追跡IDでログ取得
- `getExpiredLogEntries()` - 期限切れログ取得

#### **Triggers.gs** - トリガー管理
- `setupAllTriggers()` - 全トリガー一括作成
- `deleteAllTriggers()` - 全トリガー削除
- `listAllTriggers()` - トリガー一覧表示

#### **bootstrap.gs** - 初期セットアップ
- `bootstrapSecureLocker()` - フォルダ作成・HMAC生成
- `createFolderInSharedDrive_()` - 共有ドライブにフォルダ作成

#### **cryptojs_min.gs** - CryptoJS
- CryptoJS最小バンドル（529行）
- 含まれるモジュール: core, enc-base64, sha256, hmac-sha256, pbkdf2, cipher-core, mode-cbc, pad-pkcs7, aes

#### **DownloadPage.html** - ダウンロードページUI（受信者用）
- **.yenc ファイルダウンロード前の認証UI**
- 主な機能:
  - メールアドレス入力 → パスワード発行（ワンタイムパスワード）
  - パスワード入力 → 認証成功 → ファイルダウンロード
  - 3ステップワークフロー（メール入力 → PW入力 → ダウンロード）
  - ファイル一覧表示（ファイル名、サイズ）
  - 有効期限表示
- デザイン:
  - **企業カラー #0075c1** を全体に適用
  - グラデーション背景（#0075c1 → #005a9e）
  - モダンなカードUIとアニメーション
  - レスポンシブデザイン（モバイル対応）
  - **NHPロゴ風ファビコン**（インラインSVG、data URI形式）
- セキュリティ:
  - Google Apps Script（`google.script.run`）でサーバー側認証
  - トラッキングID + メールアドレス + パスワードの3要素認証
  - パスワードは24桁、有効期限付き
- 配布方法:
  - Web Apps として Google Apps Script からデプロイ
  - URLパラメータでトラッキングIDを指定

#### **DecryptUI.html** - ブラウザ復号UI（受信者用）
- **.yenc ファイルアップロード + パスワード入力 → 復号**
- CryptoJS 4.1.1（CDN）を使用
- 完全クライアント側処理（サーバーへのパスワード送信なし）
- 主な機能:
  - ドラッグ&ドロップ対応のファイル選択
  - ファイル情報の自動表示（元のファイル名、サイズ、暗号化日時）
  - リアルタイムプログレスバー
  - エラーハンドリング（MAC検証、復号失敗）
- デザイン:
  - レスポンシブデザイン
  - モダンなグラデーション背景
  - 成功/エラーメッセージの明示
- 配布方法:
  - ローカルファイルとして受信者に配布
  - Webサーバーでホスティング（推奨）

#### **decrypt.html** - 復号UI（旧版）
- OTP認証前提の実装（将来拡張用）
- 現在は使用しない

---

## よく使う関数一覧

### セットアップ

- `bootstrapSecureLocker()` - 初期セットアップ
- `initLogSpreadsheet()` - ログSpreadsheet作成
- `setupAllTriggers()` - トリガー一括作成
- `validateConfig()` - 設定検証

### テスト

- `selfTest_EncryptSmallBlob()` - 暗号化テスト
- `testPasswordGeneration()` - パスワード生成テスト
- `testLogger()` - ログ記録テスト
- `testProcessIncomingMails()` - メール処理テスト

### メンテナンス

- `listAllTriggers()` - トリガー一覧表示
- `deleteAllTriggers()` - トリガー全削除
- `showAllProperties()` - Script Properties表示
- `testCheckExpiredFiles()` - 期限切れファイル確認
- `emergencyDeleteByTrackingId('ANGO-XXXXXXXX')` - 緊急削除

---

## セキュリティ運用

### 重要な設定

- `SECRET_HMAC`: HMAC秘密鍵（定期的なローテーション推奨）
- 共有ドライブへのアクセス権限を最小化
- ログSpreadsheetの編集権限を制限

### 監査

ログSpreadsheetの `Logs` シートで全操作を確認できます:

- **Timestamp**: 処理日時
- **TrackingID**: 追跡ID
- **Files**: ファイル情報
- **Passwords**: パスワード（マスク済み参照値）
- **Recipients**: 送信先一覧
- **Status**: 処理状態

---

## FAQ

### Q1. トリガーアドレスを変更できますか？

A1. `Config.gs` の `TRIGGER_EMAIL` を変更してください。

### Q2. 有効期限を変更できますか？

A2. `Config.gs` の `LIFECYCLE.VALIDITY_DAYS` と `DELETE_AFTER_DAYS` を変更してください。

### Q3. パスワードの長さを変更できますか？

A3. `Config.gs` の `CRYPTO.PASSWORD_LENGTH` を変更してください。

### Q4. 複数ユーザーで共有できますか？

A4. はい。各ユーザーが初回OAuth認証を行えば、executeAsUserで動作します。

### Q5. ファイルサイズ制限は？

A5. GASの制限により、1ファイル約30MB以下を推奨します。

---

## 技術実装の詳細（システム再構築ガイド）

このセクションでは、NHP SecureLockerを一から構築する方法を詳しく説明します。

### アーキテクチャ概要

```
┌─────────────────────────────────────────────────────────────┐
│  Google Apps Script (GAS) - サーバーレス実行環境            │
├─────────────────────────────────────────────────────────────┤
│  1. Gmail API (Advanced)   - メール送受信、ドラフト作成      │
│  2. Drive API (Advanced)   - 共有ドライブ操作、ファイル管理   │
│  3. Spreadsheet API        - ログ記録                       │
│  4. Time-based Triggers    - 定期実行（1分、毎日）           │
│  5. Script Properties      - 設定保存（暗号化鍵、ID等）       │
└─────────────────────────────────────────────────────────────┘
```

### 主要コンポーネント実装

#### 1. トリガーシステム（Triggers.gs）

**1分間隔トリガーの実装:**
```javascript
ScriptApp.newTrigger('processIncomingMails')
  .timeBased()
  .everyMinutes(1)  // 最短間隔
  .create();
```

**重要ポイント:**
- GASの最短トリガー間隔は1分
- 高速化のため、5分→1分に変更済み
- 実行時間は最大6分まで（GASの制限）

#### 2. メール処理フロー（MailProcessor.gs）

**未処理メール検出:**
```javascript
var query = 'to:' + SYS.TRIGGER_EMAIL + ' -label:' + SYS.LABELS.PROCESSED;
var threads = GmailApp.search(query, 0, 10);
```

**クラウドリンク除去の実装:**
```javascript
function removeCloudDriveLinks(body) {
  var patterns = [
    /https?:\/\/drive\.google\.com\/[^\s<>"]+/gi,
    /https?:\/\/[^\/]*\.box\.com\/[^\s<>"]+/gi,
    /https?:\/\/[^\/]*\.dropbox\.com\/[^\s<>"]+/gi,
    /https?:\/\/onedrive\.live\.com\/[^\s<>"]+/gi,
    // ... more patterns
  ];

  var modified = body;
  for (var i = 0; i < patterns.length; i++) {
    // HTMLリンク削除
    modified = modified.replace(
      new RegExp('<a[^>]*href=["\']?(' + patterns[i].source + ')["\']?[^>]*>.*?<\/a>', 'gi'),
      ''
    );
    // プレーンテキストURL削除
    modified = modified.replace(patterns[i], '');
  }

  return modified;
}
```

#### 3. RFC 2047 MIME エンコーディング（DraftGenerator.gs）

**日本語件名の正しいエンコード:**
```javascript
function encodeMimeWord(text) {
  // ASCII文字のみの場合はそのまま
  if (/^[\x00-\x7F]*$/.test(text)) {
    return text;
  }

  // UTF-8 → Base64
  var encoded = Utilities.base64Encode(text, Utilities.Charset.UTF_8);

  // RFC 2047形式: =?UTF-8?B?<Base64>?=
  return '=?UTF-8?B?' + encoded + '?=';
}
```

**RAWメッセージ生成:**
```javascript
function createRawMessage(params) {
  var lines = [];

  // ヘッダー
  if (params.to) lines.push('To: ' + params.to);
  if (params.bcc) lines.push('Bcc: ' + params.bcc);

  // 件名（MIME encoded-word）
  lines.push('Subject: ' + encodeMimeWord(params.subject));

  lines.push('Content-Type: text/html; charset=UTF-8');
  lines.push('Content-Transfer-Encoding: base64');
  lines.push('');

  // ボディ（Base64）
  var bodyEncoded = Utilities.base64Encode(params.body, Utilities.Charset.UTF_8);
  lines.push(bodyEncoded);

  // Gmail API用にBase64url化
  return Utilities.base64EncodeWebSafe(lines.join('\r\n'));
}
```

#### 4. パスワード生成（Crypto.gs）

**24桁強力パスワード（先頭末尾は英数字）:**
```javascript
function generateSecurePassword() {
  var cfg = {
    UPPER: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    LOWER: 'abcdefghijklmnopqrstuvwxyz',
    DIGIT: '0123456789',
    SYMBOL: '!@#$%^&*()-_=+[]{}|;:,.<>?'
  };

  var alphanumeric = cfg.UPPER + cfg.LOWER + cfg.DIGIT;

  // 先頭と末尾は英数字のみ
  var first = alphanumeric.charAt(Math.floor(Math.random() * alphanumeric.length));
  var last = alphanumeric.charAt(Math.floor(Math.random() * alphanumeric.length));

  // 中間22文字
  var middle = [];

  // 各カテゴリ最低1文字確保
  middle.push(cfg.UPPER.charAt(Math.floor(Math.random() * cfg.UPPER.length)));
  middle.push(cfg.LOWER.charAt(Math.floor(Math.random() * cfg.LOWER.length)));
  middle.push(cfg.DIGIT.charAt(Math.floor(Math.random() * cfg.DIGIT.length)));
  middle.push(cfg.SYMBOL.charAt(Math.floor(Math.random() * cfg.SYMBOL.length)));

  // 残り18文字（全文字種から）
  var allChars = cfg.UPPER + cfg.LOWER + cfg.DIGIT + cfg.SYMBOL;
  for (var i = 4; i < 22; i++) {
    middle.push(allChars.charAt(Math.floor(Math.random() * allChars.length)));
  }

  // Fisher-Yatesシャッフル
  for (var i = middle.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var temp = middle[i];
    middle[i] = middle[j];
    middle[j] = temp;
  }

  return first + middle.join('') + last;
}
```

#### 5. AES-256-CBC 暗号化（Crypto.gs + cryptojs_min.gs）

**Encrypt-then-MAC パターン:**
```javascript
function encryptFile(blob, password) {
  // 1. Saltとlv生成（16バイト）
  var salt = generateSecureRandom(16);
  var iv = generateSecureRandom(16);

  // 2. PBKDF2で鍵導出（100,000 iterations）
  var key = CryptoJS.PBKDF2(password, salt, {
    keySize: 256/32,
    iterations: 100000,
    hasher: CryptoJS.algo.SHA256
  });

  // 3. AES-256-CBC暗号化
  var plaintext = blobToWordArray(blob);
  var ciphertext = CryptoJS.AES.encrypt(plaintext, key, {
    iv: iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7
  });

  // 4. HMAC-SHA256（Encrypt-then-MAC）
  var hmacInput = salt + iv + ciphertext;
  var mac = CryptoJS.HmacSHA256(hmacInput, SECRET_HMAC);

  // 5. パッケージング（JSON Header + Base64 Ciphertext）
  var header = {
    version: '1.0',
    algorithm: 'AES-256-CBC',
    kdf: 'PBKDF2',
    kdfIter: 100000,
    kdfSaltB64: salt.toString(CryptoJS.enc.Base64),
    ivB64: iv.toString(CryptoJS.enc.Base64),
    macB64: mac.toString(CryptoJS.enc.Base64),
    originalName: blob.getName(),
    mimeType: blob.getContentType(),
    sizeBytes: blob.getBytes().length,
    createdAt: new Date().toISOString()
  };

  var packageContent = JSON.stringify(header) + '\n---\n' +
                       ciphertext.toString();

  return packageContent;
}
```

#### 6. ダウンロードページUI（DownloadPage.html）

**企業カラー適用:**
```css
/* 企業カラー #0075c1 を全体に適用 */
body {
  background: linear-gradient(135deg, #0075c1 0%, #005a9e 100%);
}

.btn-primary {
  background: linear-gradient(135deg, #0075c1 0%, #0094d9 100%);
  box-shadow: 0 2px 8px rgba(0, 117, 193, 0.25);
}

.btn-primary:hover:not(:disabled) {
  background: linear-gradient(135deg, #005a9e 0%, #0075c1 100%);
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(0, 117, 193, 0.4);
}

input:focus {
  border-color: #0075c1;
  box-shadow: 0 0 0 3px rgba(0, 117, 193, 0.15);
}
```

**ファビコン（インラインSVG）:**
```html
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect fill='%230075c1' width='100' height='100' rx='20'/%3E%3Cpath fill='white' d='M50 25c-8.3 0-15 6.7-15 15v8h-5c-2.8 0-5 2.2-5 5v22c0 2.8 2.2 5 5 5h40c2.8 0 5-2.2 5-5V53c0-2.8-2.2-5-5-5h-5v-8c0-8.3-6.7-15-15-15zm0 6c5.5 0 10 4.5 10 10v8H40v-8c0-5.5 4.5-10 10-10zm0 25c2.8 0 5 2.2 5 5s-2.2 5-5 5-5-2.2-5-5 2.2-5 5-5z'/%3E%3C/svg%3E">
```

**重要ポイント:**
- `data:image/svg+xml` で外部ファイル不要
- URLエンコードされたSVGを直接埋め込み
- CORS問題を完全回避

### セットアップチェックリスト

システムを一から構築する場合、以下の順序で実施してください:

#### フェーズ1: 環境準備
- [ ] Google Workspace アカウント取得
- [ ] 共有ドライブ作成
- [ ] Google Apps Script プロジェクト作成

#### フェーズ2: コードデプロイ
- [ ] すべての `.gs` ファイルをコピー
- [ ] すべての `.html` ファイルをコピー
- [ ] `appsscript.json` で Advanced Services 有効化
  - [ ] Drive API v2
  - [ ] Gmail API v1

#### フェーズ3: 初期設定
- [ ] Script Properties に `SHARED_DRIVE_ID` を設定
- [ ] `bootstrapSecureLocker()` 実行
- [ ] `initLogSpreadsheet()` 実行
- [ ] `setupAllTriggers()` 実行
- [ ] `validateConfig()` で検証

#### フェーズ4: テスト
- [ ] `selfTest_EncryptSmallBlob()` - 暗号化テスト
- [ ] `testPasswordGeneration()` - パスワード生成テスト
- [ ] 実際にテストメール送信
- [ ] ドラフト作成を確認
- [ ] パスワード通知を確認
- [ ] ファイルダウンロード・復号を確認

#### フェーズ5: 運用開始
- [ ] ユーザーに使い方を説明
- [ ] ログSpreadsheetを定期確認
- [ ] トリガー実行状況を監視
- [ ] 期限切れファイルの自動削除を確認

### トラブルシューティング（詳細版）

#### 問題: ファビコンが表示されない

**原因:**
1. 外部URLを使用している（CORS制限）
2. Google Drive共有設定が不適切
3. ブラウザキャッシュの問題

**解決策:**
```html
<!-- ❌ 動作しない方法 -->
<link rel="icon" href="https://drive.google.com/uc?export=view&id=xxxxx">

<!-- ✅ 確実に動作する方法（インラインSVG） -->
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg...%3E">
```

#### 問題: 日本語件名が文字化けする

**原因:**
- 受信側がShift-JIS環境
- 件名がUTF-8で正しくエンコードされていない

**解決策:**
RFC 2047 MIME encoding を実装（DraftGenerator.gs:108-121）

#### 問題: パスワードが30秒以内に届かない

**原因:**
- トリガー間隔が5分（旧設定）

**解決策:**
Triggers.gs:17-20 で `everyMinutes(1)` に変更済み

#### 問題: クラウドストレージのリンクが残っている

**原因:**
- `removeCloudDriveLinks()` が未実装

**解決策:**
MailProcessor.gs に正規表現パターンマッチング実装済み

---

## ライセンス

- **CryptoJS**: MIT License
- **本システム**: 社内利用（NHP）

---

## お問い合わせ

不具合や改善要望は、プロジェクト管理者までご連絡ください。

---

**NHP SecureLocker v1.2 最新版**
**最終更新: 2025-11-12**
© 2025 NHP
