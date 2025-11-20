# NHP SecureLocker - 社内全体デプロイメントガイド

## 方法1: 中央集権的サービスアカウント方式（推奨）

### 概要
1つのサービスアカウント（securelocker@nhp.jp）でスクリプトを実行し、全社員がそのアドレス宛にメールを送るだけで利用できます。

### メリット
- ✅ **社員は認証不要** - ただメールを送信/受信するだけ
- ✅ **管理が簡単** - 1箇所でトリガー管理
- ✅ **既存コードそのまま** - 変更不要
- ✅ **監査が容易** - ログが1箇所に集約

### セットアップ手順

#### 1. サービスアカウントの準備

**オプションA: 既存のグループメールを使用**
```
securelocker@nhp.jp
```

**オプションB: 専用サービスアカウントを作成**
```
nhp-securelocker-service@nhp.jp
```

#### 2. サービスアカウントでスクリプトをセットアップ

1. **サービスアカウントでログイン**
   - Google Apps Scriptコンソール: https://script.google.com
   - `securelocker@nhp.jp` でログイン

2. **新規プロジェクト作成**
   - 「新しいプロジェクト」をクリック
   - プロジェクト名: `NHP SecureLocker`

3. **すべてのコードファイルをコピー**
   - 以下のファイルを全てコピー&ペースト:
     ```
     Config.gs
     Crypto.gs
     MailProcessor.gs
     DraftGenerator.gs
     PasswordNotifier.gs
     LifecycleManager.gs
     Logger.gs
     Triggers.gs
     SystemControl.gs
     bootstrap.gs
     cryptojs_min.gs
     DownloadPage.html
     DecryptUI.html
     ```

4. **appsscript.json を更新**
   - 「プロジェクトの設定」→「appsscript.json をエディタで表示」をON
   - このリポジトリの `appsscript.json` の内容をコピー

5. **Advanced Services を有効化**
   - 「サービス」→「Gmail API v1」を追加
   - 「サービス」→「Drive API v2」を追加

#### 3. 共有ドライブの権限設定

1. **共有ドライブにアクセス権を付与**
   ```
   共有ドライブ名: （例）NHP SecureLocker Storage

   メンバーに追加:
   - securelocker@nhp.jp（編集者）
   ```

2. **共有ドライブIDを取得**
   - 共有ドライブを開く
   - URLから ID を取得: `https://drive.google.com/drive/folders/【ここがID】`

#### 4. Script Properties 設定

1. **プロジェクトの設定** → **スクリプト プロパティ**
2. 以下を追加:
   ```
   SHARED_DRIVE_ID = 【共有ドライブID】
   ```

#### 5. Bootstrap 実行

GASエディタで以下の関数を順番に実行:

```javascript
// 1. フォルダとHMAC秘密鍵の生成
bootstrapSecureLocker()

// 2. ログSpreadsheet初期化
initLogSpreadsheet()

// 3. トリガーセットアップ（1分間隔 + 毎日午前2時）
setupAllTriggers()

// 4. 設定検証
validateConfig()
```

#### 6. 権限承認

初回実行時に権限リクエストが表示されます:
- Gmail の読み取り・送信
- Drive のファイル作成・削除
- Spreadsheet の読み書き

**「詳細」→「安全でないページに移動」→「許可」** をクリックして承認してください。

#### 7. テスト送信

テストメールを送信:
```
宛先: securelocker@nhp.jp
件名: テスト
添付: 任意のファイル
```

1分以内にドラフトが `securelocker@nhp.jp` の受信トレイに作成されることを確認。

---

## 方法2: 各ユーザーがスクリプトをコピー

各社員が自分のGoogleアカウントでスクリプトのコピーを持ち、個別に実行する方式です。

### メリット
- ✅ API制限が各自に分散
- ✅ 各自が独立して管理
- ✅ カスタマイズ可能

### デメリット
- ❌ 全員が認証必要
- ❌ 管理が分散（トラブルシューティングが困難）
- ❌ アップデートが大変

### セットアップ手順

#### 1. テンプレートスクリプトを準備

管理者が「マスター」スクリプトを作成し、共有リンクを生成します。

**GASプロジェクトの共有:**
1. GASエディタで「デプロイ」→「新しいデプロイ」
2. タイプ: **ライブラリ**
3. 公開範囲: **nhp.jp ドメイン内のユーザー**
4. スクリプトIDをコピー

#### 2. 社員向け配布リンク作成

以下の内容でイントラネットやメールで案内:

```markdown
# NHP SecureLocker 個人利用ガイド

## セットアップ（初回のみ）

1. **スクリプトをコピー**
   - このリンクにアクセス: https://script.google.com/d/【スクリプトID】/edit
   - 「ファイル」→「コピーを作成」

2. **共有ドライブ権限を確認**
   - 共有ドライブ「NHP SecureLocker Storage」に参加していることを確認

3. **Bootstrap実行**
   - 関数 `bootstrapSecureLocker()` を実行
   - 権限承認を求められたら「許可」

4. **トリガーセットアップ**
   - 関数 `setupAllTriggers()` を実行

## 使い方

securelocker@nhp.jp 宛にメール送信するだけ！
```

**問題点:**
- 各自がトリガーを設定すると、同じメールを複数回処理してしまう可能性がある
- → **Config.gs の TRIGGER_EMAIL を各自のメールアドレスに変更する必要がある**

---

## 方法3: Web App デプロイ（OAuth承認リンク方式）

Web Appとしてデプロイし、初回アクセス時に各ユーザーが認証する方式です。

### セットアップ手順

#### 1. Web App としてデプロイ

1. GASエディタで「デプロイ」→「新しいデプロイ」
2. タイプ: **ウェブアプリ**
3. 設定:
   ```
   次のユーザーとして実行: ユーザーがウェブアプリにアクセス
   アクセスできるユーザー: nhp.jp ドメイン内のユーザー
   ```
4. 「デプロイ」をクリック
5. **Web App URL** をコピー

#### 2. 社内に配布

イントラネットやメールで以下を配布:

```markdown
# NHP SecureLocker 利用開始

以下のリンクにアクセスして、初回認証を完了してください:

https://script.google.com/macros/s/【デプロイID】/exec

※ 初回アクセス時に権限承認が必要です。
```

**課題:**
- Web Appは通常HTTPリクエストを受け取るためのもの
- 時間ベーストリガーとは相性が悪い
- この用途には**不向き**

---

## 推奨デプロイ方法の比較

| 方法 | 社員の認証 | 管理の容易さ | API制限 | トラブル対応 | 推奨度 |
|------|-----------|-------------|---------|-------------|--------|
| **方法1: サービスアカウント** | 不要 ✅ | 簡単 ✅ | 集中（500/日） | 容易 ✅ | ⭐⭐⭐⭐⭐ |
| 方法2: 各自コピー | 必要 ❌ | 困難 ❌ | 分散 ✅ | 困難 ❌ | ⭐⭐ |
| 方法3: Web App | 必要 ❌ | 中程度 | 集中 | 中程度 | ⭐ |

---

## 実装例: サービスアカウント方式の完全な手順

### 前提条件

- サービスアカウント: `securelocker@nhp.jp`
- 共有ドライブ: `NHP SecureLocker Storage`（ID: `0APbz-T9cPss3Uk9PVA`）

### ステップ1: サービスアカウントでログイン

```bash
# ブラウザで以下にアクセス
https://script.google.com

# securelocker@nhp.jp でログイン
```

### ステップ2: プロジェクト作成とコードデプロイ

1. 「新しいプロジェクト」作成
2. すべての `.gs` と `.html` ファイルをコピー
3. `appsscript.json` を設定

### ステップ3: 設定とBootstrap

```javascript
// Script Properties に追加
SHARED_DRIVE_ID = "0APbz-T9cPss3Uk9PVA"

// 実行
bootstrapSecureLocker()  // フォルダ作成
initLogSpreadsheet()     // ログ初期化
setupAllTriggers()       // トリガー設定
```

### ステップ4: 社内への案内

```markdown
件名: 【新サービス】NHP SecureLocker 暗号化ファイル送信システム

NHPセキュアロッカーが利用可能になりました。

## 使い方
1. securelocker@nhp.jp 宛にメールを送信（添付ファイル付き）
2. 1分以内にドラフトが作成されます
3. To/Ccに送信先を追加して送信
4. 受信者全員に自動的にパスワードが送信されます

詳細マニュアル: 【社内Wiki URL】
```

---

## FAQ

### Q1. 複数人が同時に使っても大丈夫？
A1. はい。LockServiceで排他制御しているため、並行処理に対応しています。

### Q2. API制限は大丈夫？
A2. Gmail API送信制限: 1日500通
    1日100件までの送信を想定している場合は問題ありません。
    それ以上の場合は Google Workspace Business 以上のプランが必要です。

### Q3. トリガーが動かない場合は？
A3. 以下を確認:
```javascript
listAllTriggers()  // トリガー一覧表示
validateConfig()   // 設定検証
```

### Q4. ユーザーが独自にカスタマイズしたい場合は？
A4. 方法2（各自コピー）を採用し、Config.gs の TRIGGER_EMAIL を各自のメールアドレスに変更してください。

---

## セキュリティ考慮事項

### 1. サービスアカウントのセキュリティ

- **2段階認証を有効化**
- **パスワードを強固に設定**
- **ログイン履歴を定期確認**

### 2. Script Properties の保護

Script Propertiesには以下の機密情報が含まれます:
- `SECRET_HMAC`: HMAC秘密鍵
- `SHARED_DRIVE_ID`: 共有ドライブID

**対策:**
- GASプロジェクトの編集権限を最小限に
- 定期的に `SECRET_HMAC` をローテーション（再生成）

### 3. 監査ログ

ログSpreadsheetで全ての処理を記録:
```
Timestamp | TrackingID | OwnerEmail | Files | Status
```

定期的にレビューしてください。

---

## トラブルシューティング

### エラー: "権限がありません"

**原因:** サービスアカウントが共有ドライブにアクセスできない

**解決策:**
1. 共有ドライブのメンバー設定を確認
2. `securelocker@nhp.jp` が「編集者」以上の権限を持っていることを確認

### エラー: "トリガーが実行されない"

**原因:** トリガーが正しく設定されていない

**解決策:**
```javascript
deleteAllTriggers()  // 既存トリガー削除
setupAllTriggers()   // 再設定
listAllTriggers()    // 確認
```

### エラー: "Gmail API の割り当てを超えました"

**原因:** 1日500通の送信制限を超過

**解決策:**
- Google Workspace のプランをアップグレード
- または複数のサービスアカウントで負荷分散

---

**最終更新:** 2025-11-20
**対象バージョン:** NHP SecureLocker v1.2
