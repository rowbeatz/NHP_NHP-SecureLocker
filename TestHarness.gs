/**** TestHarness.gs — 完全置換版 ****/

// テスト対象のDriveファイルURL/ID/フォルダIDを必要に応じてセット
var TEST_URL = "https://drive.google.com/file/d/1LR3jpNS6f3MPi1V_MbI8HwrtINhibwGy/view?usp=sharing";
var TEST_FILE_ID = "1LR3jpNS6f3MPi1V_MbI8HwrtINhibwGy";
var TEST_FOLDER_ID = "0ABM0I-Rk5AnQUk9PVA";

function runSanityCheck(){ runSanityCheck_(); }

function runSelfTest(){
  runSanityCheck_();
  var res = selfTest_EncryptSmallBlob();
  Logger.log("SELFTEST OK: %s", JSON.stringify(res));
}

function runDryRunByUrl(){
  if(!TEST_URL) throw new Error("TEST_URL が空です。テストURLを入れてください。");
  var res = dryRunEncryptFromDriveUrl(TEST_URL);
  Logger.log("OK: "+JSON.stringify(res));
}

// 詳細ログ付き（同じ関数を呼ぶが、開始前に追加ログを出す）
function runDryRunByUrlVerbose(){
  Logger.log("[VERBOSE] runDryRunByUrlVerbose start url="+TEST_URL);
  var res = runDryRunByUrl();
  Logger.log("[VERBOSE] done");
  return res;
}

function runDryRunByFileId(){
  if(!TEST_FILE_ID) throw new Error("TEST_FILE_ID が空です。URLからIDを抜いてセットしてください。");
  var res = dryRunEncryptFromDriveFile(TEST_FILE_ID);
  Logger.log("OK: "+JSON.stringify(res));
}

function runDryRunByFolderId(){
  if(!TEST_FOLDER_ID) throw new Error("TEST_FOLDER_ID が空です。フォルダIDを入れてください。");
  var res = dryRunEncryptFromSharedDrive(TEST_FOLDER_ID);
  Logger.log("OK: "+JSON.stringify(res));
}

function help(){ helpHowToGetDriveIds(); }
function debugCheckIdType(){
  var id = TEST_FOLDER_ID || TEST_FILE_ID;
  if(!id) throw new Error("TEST_FOLDER_ID か TEST_FILE_ID を入れてから実行してください。");
  var meta = Drive.Files.get(id,{supportsTeamDrives:true});
  Logger.log("title=%s, mimeType=%s", meta.title, meta.mimeType);
}
