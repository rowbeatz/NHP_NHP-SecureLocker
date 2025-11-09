# NHP SecureLocker - セットアップガイド

Google Apps Script (GAS) による暗号化メール送信システム

**バージョン: v1.0 完全版**
**最終更新: 2025-11-09**

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
- **パスワード**: 24桁ランダム生成（英大小数字記号混在）

---

## システムフロー

```
[送信者] → y-furusawa+ango@nhp.jp 宛にメール送信（添付/Driveリンク付き）
   ↓
[processIncomingMails] 5分ごとのトリガーで自動実行
   ↓
[添付/リンク暗号化] → Drive保存 → 追跡ID付与 → ログ記録
   ↓
[ドラフト生成] 同スレッド、Bcc: ango@nhp.jp + 送信者
   ↓
[送信者] To/Cc追加 → 手動送信
   ↓
[processSentMailsForPassword] 5分ごとのトリガーで自動実行
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
   - **メール処理**: 5分ごと
   - **パスワード送信**: 5分ごと
   - **期限切れ削除**: 毎日午前2時

3. トリガー確認: 関数 `listAllTriggers()` で一覧表示

### 8. 設定検証

関数 `validateConfig()` を実行

すべて✓であればセットアップ完了です。

---

## 使い方

### 送信者（暗号化ファイルを送りたい人）

#### 1. メール作成と送信

```
宛先: y-furusawa+ango@nhp.jp
件名: （自由）
本文: （実際に送りたい内容）
添付: 暗号化したいファイル、またはDriveリンク
```

送信後、5分以内に自動処理が開始されます。

#### 2. ドラフト確認

Gmailのドラフトに以下の内容で自動生成されます:

- 本文の添付/リンクが暗号化Driveリンクに差し替え
- 本文末に追跡ID `[#ANGO-XXXXXXXX]` が付与
- Bcc: `y-furusawa+ango@nhp.jp, 送信者自身`

#### 3. 宛先追加と送信

- To/Ccに実際の送信先アドレスを入力
- そのまま送信

#### 4. パスワード自動送信

送信後5分以内に、To/Cc/Bccの全員にパスワード通知メールが自動送信されます。

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

#### 4. 復号

現在はブラウザ復号UIが未統合です。
サーバー側復号関数 `decryptFile()` でテスト可能（Crypto.gs）

※ブラウザ復号UIの統合は次フェーズで実装予定

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

実際に `y-furusawa+ango@nhp.jp` 宛にテストメールを送信してから:

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
2. 宛先が `y-furusawa+ango@nhp.jp` か
3. ラベル `es_processed` が付与されていないか

### パスワード通知メールが送信されない

**確認事項**:
1. ドラフトを実際に送信したか
2. Bccに `y-furusawa+ango@nhp.jp` が含まれているか
3. 追跡ID `[#ANGO-XXXXXXXX]` が本文にあるか
4. ラベル `es_pw_sent` が付与されていないか

---

## ファイル構成

```
NHP-SecureLocker/
├── appsscript.json          # プロジェクト設定
├── Config.gs                # システム設定・定数
├── Crypto.gs                # 暗号化エンジン
├── MailProcessor.gs         # メール処理
├── DraftGenerator.gs        # ドラフト生成
├── PasswordNotifier.gs      # パスワード通知
├── LifecycleManager.gs      # ライフサイクル管理
├── Logger.gs                # ログ管理
├── Triggers.gs              # トリガー管理
├── bootstrap.gs             # 初期セットアップ
├── TestHarness.gs           # テストハーネス
├── cryptojs_min.gs          # CryptoJS ライブラリ
├── decrypt.html             # 復号UI（未統合）
└── README.md                # このファイル
```

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

## ライセンス

- **CryptoJS**: MIT License
- **本システム**: 社内利用（NHP）

---

## お問い合わせ

不具合や改善要望は、プロジェクト管理者までご連絡ください。

---

**NHP SecureLocker v1.0 完全版**
© 2025 NHP
