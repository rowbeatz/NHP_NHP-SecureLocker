/**** Code.gs — 完全置換版（Helper迂回で安定化） ****/

/* ========= Config utilities ========= */
function CFG(key, def){var p=PropertiesService.getScriptProperties();var v=p.getProperty(key);return (v!==null&&v!==undefined&&v!=="")?v:def;}
function CFGI(key, def){var v=CFG(key,null);if(v===null||v===undefined||v==="")return def;var n=Number(v);return isNaN(n)?def:n;}

/* ========= System config ========= */
var SYS={
  SYSTEM_EMAIL:CFG("SYSTEM_EMAIL","y-furusawa+ango@nhp.jp"),
  SYSTEM_NAME_JP:CFG("SYSTEM_NAME_JP","NHP AI セキュアLocker システム"),
  SYSTEM_NAME_EN:CFG("SYSTEM_NAME_EN","NHP SecureLocker"),
  SHARED_DRIVE_ID:CFG("SHARED_DRIVE_ID","0APbz-T9cPss3Uk9PVA"),
  FOLDER_ENCRYPTED_ID:CFG("FOLDER_ENCRYPTED_ID","1KMPtm8RZlb2GPPFM-uGGROfP5fXuTWyy"),
  FOLDER_LOGS_ID:CFG("FOLDER_LOGS_ID","15RokJwk4c5vtR5E83oX1IYkIO83lnmgu"),
  SHEET_ID:CFG("SHEET_ID","1t5ZJH83eIFHdPekZsk9yjOsYy0by8IbTVUelwmIvXSM"),
  DEFAULT_EXPIRY_DAYS:CFGI("DEFAULT_EXPIRY_DAYS",14),
  DELETE_AFTER_DAYS:CFGI("DELETE_AFTER_DAYS",15),
  PW_LEN:CFGI("PW_LEN",24),
  PW_SYMBOLS:CFG("PW_SYMBOLS","!@#$%^&*()-_=+[]{}:,.?"),
  OTP_REQUIRED:String(CFG("OTP_REQUIRED","true")).toLowerCase()==="true",
  OTP_CODE_LENGTH:CFGI("OTP_CODE_LENGTH",6),
  OTP_TTL_MIN:CFGI("OTP_TTL_MIN",10),
  OTP_RESEND_COOLDOWN_SEC:CFGI("OTP_RESEND_COOLDOWN_SEC",30),
  OTP_MAX_ISSUE_PER_30MIN:CFGI("OTP_MAX_ISSUE_PER_30MIN",5),
  OTP_MAX_VERIFY_ATTEMPTS:CFGI("OTP_MAX_VERIFY_ATTEMPTS",5),
  OTP_LOCK_MIN:CFGI("OTP_LOCK_MIN",10),
  SECRET_HMAC:CFG("SECRET_HMAC",""),
  KDF_MODE:(CFG("KDF_MODE","FAST")+"").toUpperCase(),
  KDF_ITERATIONS:CFGI("KDF_ITERATIONS",60000)
};

/* ========= Helpers ========= */
function plusDays_(d,days){var t=new Date(d.getTime());t.setDate(t.getDate()+days);return t;}
function randomInt_(min,max){return Math.floor(Math.random()*(max-min+1))+min;}
function generatePassword_(len,symbols){
  var lowers="abcdefghijkmnopqrstuvwxyz",uppers="ABCDEFGHJKLMNPQRSTUVWXYZ",digits="23456789",syms=symbols||"!@#$%^&*()-_=+[]{}:,.?";
  var all=lowers+uppers+digits+syms,out=[];
  out.push(lowers.charAt(randomInt_(0,lowers.length-1)));
  out.push(uppers.charAt(randomInt_(0,uppers.length-1)));
  out.push(digits.charAt(randomInt_(0,digits.length-1)));
  out.push(syms.charAt(randomInt_(0,syms.length-1)));
  for(var i=out.length;i<len;i++) out.push(all.charAt(randomInt_(0,all.length-1)));
  for(var j=out.length-1;j>0;j--){var k=Math.floor(Math.random()*(j+1));var tmp=out[j];out[j]=out[k];out[k]=tmp;}
  return out.join("");
}
function sanitizeFilename_(name){return (name||"noname").replace(/[\\\/:*?"<>|#\[\]\n\r\t]/g,"_").slice(0,180);}
function doWithRetry_(fn,opt){var max=(opt&&opt.maxAttempts)||5,delay=(opt&&opt.initialMs)||500,f=(opt&&opt.factor)||1.8,j=(opt&&opt.jitterMs)||300,last=null;
  for(var i=0;i<max;i++){try{return fn();}catch(e){last=e;Utilities.sleep(delay+Math.floor(Math.random()*j));delay=Math.floor(delay*f);}}
  throw last;
}

/* ========= Logging ========= */
function ensureFolders_(){
  var enc=DriveApp.getFolderById(SYS.FOLDER_ENCRYPTED_ID);
  var logs=DriveApp.getFolderById(SYS.FOLDER_LOGS_ID);
  Logger.log("Encrypted folder: "+buildFolderPath_(enc));
  Logger.log("Logs folder: "+buildFolderPath_(logs));
  var sample=Utilities.computeHmacSha256Signature("sample",SYS.SECRET_HMAC||"seed");
  Logger.log("HMAC sample: "+Utilities.base64Encode(sample).substr(0,16)+"...");
}
function buildFolderPath_(folder){
  var names=[folder.getName()];
  try{var p=folder.getParents();while(p.hasNext()){var f=p.next();names.push(f.getName());p=f.getParents();}}catch(e){}
  names.reverse();return names.join("/");
}
function logLine_(tag,obj){
  try{
    var logsFolder=DriveApp.getFolderById(SYS.FOLDER_LOGS_ID);
    var dateStr=Utilities.formatDate(new Date(),Session.getScriptTimeZone(),"yyyyMMdd");
    var logName="securelocker-"+dateStr+".log";
    var it=logsFolder.getFilesByName(logName);
    var file=it.hasNext()?it.next():logsFolder.createFile(logName,"",MimeType.PLAIN_TEXT);
    var line=new Date().toISOString()+" ["+tag+"] "+(typeof obj==="string"?obj:JSON.stringify(obj))+"\n";
    file.appendChunk(line);
  }catch(e){Logger.log("LOG ERR: "+(e&&e.message||e));}
}
function appendSheetLog_(row){
  var ss=SpreadsheetApp.openById(SYS.SHEET_ID);
  var sh=ss.getSheetByName("Logs")||ss.insertSheet("Logs");
  var headers=["timestamp","action","srcId","srcName","outId","outName","link","expiresAt","deleteAfter","passwordRef","note"];
  if(sh.getLastRow()===0) sh.appendRow(headers);
  sh.appendRow([
    row.timestamp||new Date(),row.action||"",row.srcId||"",row.srcName||"",
    row.outId||"",row.outName||"",row.link||"",row.expiresAt||"",row.deleteAfter||"",
    row.passwordRef||"",row.note||""
  ]);
}

/* ========= Bytes/WordArray & HKDF ========= */
function toBytes_(v){if(typeof v==='string')return Utilities.newBlob(v,'application/octet-stream').getBytes();
  if(v&&typeof v==='object'&&Object.prototype.toString.call(v)==='[object ArrayBuffer]')return Utilities.newBlob([].slice.call(new Uint8Array(v)),'application/octet-stream').getBytes();
  if(Array.isArray(v))return Utilities.newBlob(v,'application/octet-stream').getBytes();
  return Utilities.newBlob(v,'application/octet-stream').getBytes();}
function strToBytesUtf8_(s){return Utilities.newBlob(s,'application/octet-stream').getBytes();}
function hexToBytes_(hex){var out=[];for(var i=0;i<hex.length;i+=2)out.push(parseInt(hex.substr(i,2),16));return out;}
function bytesToWordArray_(bytes){var js=Array.prototype.slice.call(bytes),words=[];for(var i=0;i<js.length;i++){words[i>>>2]|=(js[i]&0xff)<<(24-8*(i%4));}return CryptoJS.lib.WordArray.create(words,js.length);}
function concatJsBytes_(a,b){var aa=[].slice.call(a),bb=[].slice.call(b);return aa.concat(bb);}
function hkdfSha256_(passwordBytes,saltBytes,infoBytes,lengthBytes){
  var prk=Utilities.computeHmacSha256Signature(toBytes_(passwordBytes),toBytes_(saltBytes));
  var okmJs=[],t=[],infoJs=[].slice.call(infoBytes),blockCount=Math.ceil(lengthBytes/32);
  for(var i=1;i<=blockCount;i++){
    var msgJs=concatJsBytes_(t,infoJs);msgJs.push(i&0xff);
    var tBytes=Utilities.computeHmacSha256Signature(toBytes_(msgJs),toBytes_(prk));
    t=[].slice.call(tBytes);okmJs=okmJs.concat(t);
  }
  okmJs.length=lengthBytes;return toBytes_(okmJs);
}
function deriveKeyWordArray_(passwordStr,saltHex){
  if((SYS.KDF_MODE||'FAST')==='PBKDF2'){
    var iters=SYS.KDF_ITERATIONS||60000;Logger.log('[TRACE] KDF:PBKDF2 iters=%s (slow)',iters);
    return CryptoJS.PBKDF2(passwordStr,CryptoJS.enc.Utf8.parse(saltHex),{keySize:64/4,iterations:iters,hasher:CryptoJS.algo.SHA256});
  }else{
    Logger.log('[TRACE] KDF:FAST(HKDF) start');
    var pwBytes=strToBytesUtf8_(passwordStr);
    var saltBytes=toBytes_(hexToBytes_(saltHex));
    var infoBytes=strToBytesUtf8_('NHP-SecureLocker');
    var keyBytes=hkdfSha256_(pwBytes,saltBytes,infoBytes,64);
    var wa=bytesToWordArray_(keyBytes);
    Logger.log('[TRACE] KDF:FAST(HKDF) done');
    return wa;
  }
}

/* ========= Random (WordArray.randomを使わない) ========= */
function randomBytes_(n){
  var out=[];
  while(out.length<n){
    var seed=Utilities.getUuid()+":"+new Date().getTime()+":"+Math.random();
    var key=SYS.SECRET_HMAC||Utilities.getUuid();
    var h=Utilities.computeHmacSha256Signature(seed,key);
    out=out.concat([].slice.call(h));
  }
  out.length=n;return out;
}
function wordArrayRandomWA_(n){return bytesToWordArray_(randomBytes_(n));}

/* ========= Drive helpers ========= */
function extractFileIdFromUrl_(url){
  if(!url)return null;
  var m=url.match(/\/d\/([a-zA-Z0-9_-]{10,})/); if(m&&m[1])return m[1];
  var m2=url.match(/[?&]id=([a-zA-Z0-9_-]{10,})/); if(m2&&m2[1])return m2[1];
  return null;
}
function getFileMeta_(fileId){return Drive.Files.get(fileId,{supportsTeamDrives:true,supportsAllDrives:true});}
function exportMimeToExt_(mt){if(mt===MimeType.PDF)return ".pdf";if(mt==="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")return ".xlsx";if(mt===MimeType.PNG)return ".png";return "";}
function getBlobFromFileId_(fileId,mimeType,title){
  var name=sanitizeFilename_(title||"file"),mt=mimeType||"";
  if(/^application\/vnd\.google-apps/.test(mt)){
    var exportMime=null;
    if(mt==="application/vnd.google-apps.document")exportMime=MimeType.PDF;
    else if(mt==="application/vnd.google-apps.spreadsheet")exportMime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    else if(mt==="application/vnd.google-apps.presentation")exportMime=MimeType.PDF;
    else if(mt==="application/vnd.google-apps.drawing")exportMime=MimeType.PNG;
    else exportMime=MimeType.PDF;
    var blob=Drive.Files.export(fileId,exportMime,{supportsTeamDrives:true,supportsAllDrives:true});
    blob.setName(name+exportMimeToExt_(exportMime));return blob;
  }else{
    var file=DriveApp.getFileById(fileId);var b=file.getBlob();b.setName(name);return b;
  }
}

/* ========= Encrypt main (低レベルAPIでAES実行) ========= */
function encryptBlobToDrive_(blob, originalName){
  Logger.log("[TRACE] ENC:init name=%s size=%s", originalName, blob.getBytes().length);

  var pw=generatePassword_(SYS.PW_LEN,SYS.PW_SYMBOLS);
  var salt=Utilities.getUuid().replace(/-/g,"").slice(0,16);

  var keyWA=deriveKeyWordArray_(pw,salt); // 64B
  var iv=wordArrayRandomWA_(16);          // 16B

  // Blob -> WordArray
  var bytes=blob.getBytes(),words=[];
  for(var i=0;i<bytes.length;i++){words[i>>>2]|=(bytes[i]&0xff)<<(24-8*(i%4));}
  var dataWA=CryptoJS.lib.WordArray.create(words,bytes.length);

  // AES-256-CBC (ヘルパー経由を避ける)
  var aesKey=CryptoJS.lib.WordArray.create(keyWA.words.slice(0,8),32);
  Logger.log("[TRACE] ENC:aes start");
  var encryptor=CryptoJS.algo.AES.createEncryptor(aesKey,{
    iv:iv,
    mode:CryptoJS.mode.CBC,
    padding:CryptoJS.pad.Pkcs7
  });
  var cipherWA=encryptor.finalize(dataWA); // WordArray
  Logger.log("[TRACE] ENC:aes done");

  // 出力ヘッダ + Base64
  var header="SL1:"+salt+":"+CryptoJS.enc.Hex.stringify(iv)+":";
  var cipherB64=CryptoJS.enc.Base64.stringify(cipherWA);
  var outStr=header+cipherB64;

  var outName=sanitizeFilename_(originalName)+".enc";
  var outBlob=Utilities.newBlob(outStr,MimeType.PLAIN_TEXT,outName);

  // Drive 保存
  var encFolderId=SYS.FOLDER_ENCRYPTED_ID;
  var outId,outUrl;

  Logger.log("[TRACE] DRIVE:create (DriveApp) start -> %s",outName);
  try{
    var outFile=doWithRetry_(function(){return DriveApp.getFolderById(encFolderId).createFile(outBlob);},
      {maxAttempts:6,initialMs:800,factor:2.0,jitterMs:500});
    outId=outFile.getId();outUrl=outFile.getUrl();
    Logger.log("[TRACE] DRIVE:create (DriveApp) ok id=%s",outId);
  }catch(e1){
    Logger.log("[TRACE][WARN] DriveApp.createFile failed: %s",String(e1&&e1.message||e1));
    Logger.log("[TRACE] DRIVE:create (Drive API) fallback start");
    var meta={title:outName,mimeType:MimeType.PLAIN_TEXT,parents:[{id:encFolderId}]};
    var inserted=doWithRetry_(function(){return Drive.Files.insert(meta,outBlob,{supportsTeamDrives:true,supportsAllDrives:true});},
      {maxAttempts:7,initialMs:1000,factor:2.0,jitterMs:600});
    outId=inserted.id;outUrl=(inserted.alternateLink||inserted.webViewLink||("https://drive.google.com/file/d/"+outId+"/view"));
    Logger.log("[TRACE] DRIVE:create (Drive API) ok id=%s",outId);
  }

  // 共有リンク有効化
  Logger.log("[TRACE] DRIVE:share start id=%s",outId);
  var sharedOk=false;
  try{
    doWithRetry_(function(){DriveApp.getFileById(outId).setSharing(DriveApp.Access.ANYONE_WITH_LINK,DriveApp.Permission.VIEW);return true;},
      {maxAttempts:5,initialMs:600,factor:2.0,jitterMs:400});
    sharedOk=true;Logger.log("[TRACE] DRIVE:share (DriveApp) ok url=%s",outUrl);
  }catch(e3){
    Logger.log("[TRACE][WARN] setSharing failed: %s",String(e3&&e3.message||e3));
    Logger.log("[TRACE] DRIVE:Permissions.insert fallback start");
    Drive.Permissions.insert({role:"reader",type:"anyone",withLink:true},outId,{supportsTeamDrives:true,supportsAllDrives:true});
    sharedOk=true;Logger.log("[TRACE] DRIVE:Permissions.insert ok url=%s",outUrl);
  }

  var expiresAt=plusDays_(new Date(),SYS.DEFAULT_EXPIRY_DAYS).toISOString();
  var deleteAt=plusDays_(new Date(),SYS.DELETE_AFTER_DAYS).toISOString();
  var passwordRef=CryptoJS.HmacSHA256(outId,SYS.SECRET_HMAC||"default-seed").toString();

  logLine_("ENCRYPT",{srcName:originalName,outName:outName,outId:outId,link:outUrl,shared:sharedOk,expiresAt:expiresAt,deleteAfter:deleteAt,
    passwordMasked:(pw?pw.slice(0,3)+"***("+pw.length+")":""),passwordRef:passwordRef});
  try{
    appendSheetLog_({timestamp:new Date(),action:"ENCRYPT",outId:outId,outName:outName,link:outUrl,expiresAt:expiresAt,deleteAfter:deleteAt,passwordRef:passwordRef});
  }catch(e5){logLine_("SHEET_FAIL",{err:String(e5)});}

  return {srcName:originalName,outName:outName,outId:outId,link:outUrl,passwordRef:passwordRef};
}

/* ========= Dry-run entry ========= */
function dryRunEncryptFromDriveUrl(url){
  ensureFolders_();
  logLine_("TRACE",{stage:"start",url:url});
  var id=extractFileIdFromUrl_(url);
  if(!id)throw new Error("DriveのURLから fileId を抽出できません: "+url);
  Logger.log("[TRACE] EXTRACT_ID ok id=%s",id);
  return dryRunEncryptFromDriveFile(id);
}
function dryRunEncryptFromDriveFile(fileId){
  ensureFolders_();
  if(!fileId)throw new Error("fileId が必要です");
  var meta=getFileMeta_(fileId);
  Logger.log("[TRACE] GET_META ok mime=%s, title=%s",meta.mimeType,meta.title);
  var blob=getBlobFromFileId_(fileId,meta.mimeType,meta.title);
  Logger.log("[TRACE] GET_BLOB ok size=%s",blob.getBytes().length);
  var res=encryptBlobToDrive_(blob,blob.getName());
  Logger.log("[TRACE] ENC:done id=%s",res.outId);
  return res;
}
function dryRunEncryptFromSharedDrive(folderId){
  ensureFolders_();
  if(!folderId)throw new Error("フォルダID を指定してください");
  var q="'"+folderId+"' in parents and trashed=false";
  var lst=Drive.Files.list({q:q,maxResults:25,supportsTeamDrives:true,supportsAllDrives:true});
  var items=(lst&&lst.items)||[];
  if(!items.length)throw new Error("フォルダ内に処理可能なファイルが見つかりません");
  var pick=null;
  for(var i=0;i<items.length;i++){var it=items[i];if(it.mimeType==="application/vnd.google-apps.folder")continue;pick=it;break;}
  if(!pick)throw new Error("フォルダ内に処理可能なファイルが見つかりません（すべてサブフォルダ）");
  var blob=getBlobFromFileId_(pick.id,pick.mimeType,pick.title);
  var res=encryptBlobToDrive_(blob,blob.getName());
  return res;
}
function helpHowToGetDriveIds(){
  Logger.log("URL例: https://drive.google.com/file/d/<FILE_ID>/view?usp=sharing");
  Logger.log("フォルダURL例: https://drive.google.com/drive/folders/<FOLDER_ID>");
}

/* ========= Self test ========= */
function selfTest_EncryptSmallBlob(){
  var blob=Utilities.newBlob("selftest:"+new Date().toISOString(),MimeType.PLAIN_TEXT,"selftest.txt");
  Logger.log("[TRACE] ENC:init name=%s size=%s",blob.getName(),blob.getBytes().length);
  var res=encryptBlobToDrive_(blob,blob.getName());
  return res;
}
function runSanityCheck_(){ensureFolders_();Logger.log("OK: Sanity check passed.");}
