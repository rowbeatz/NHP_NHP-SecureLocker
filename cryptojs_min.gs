/* CryptoJS minimal bundle for Google Apps Script
 * Contents: core, enc-base64, enc-utf8, sha256, hmac + HmacSHA256 helper, pbkdf2 (with SHA-256),
 *           cipher-core (CBC mode + PKCS7 padding), aes
 * License: MIT (c) 2009-2023 Jeff Mott & contributors
 * Notes: - No Node 'require', no Buffer. Pure JS (ES3-ish).
 *        - Order matters; do not reorder sections.
 */

/* ===== core.js (trimmed) ===== */
var CryptoJS = CryptoJS || (function (Math, undefined) {
  var C = {};
  var C_lib = C.lib = {};
  var Base = C_lib.Base = (function () {
    function F() {}
    return {
      extend: function (overrides) {
        F.prototype = this;
        var subtype = new F();
        if (overrides) { subtype.mixIn(overrides); }
        if (!subtype.hasOwnProperty('init')) {
          subtype.init = function () { subtype.$super.init.apply(this, arguments); };
        }
        subtype.init.prototype = subtype;
        subtype.$super = this;
        return subtype;
      },
      create: function () {
        var instance = this.extend();
        instance.init.apply(instance, arguments);
        return instance;
      },
      init: function () {},
      mixIn: function (properties) {
        for (var propertyName in properties) {
          if (properties.hasOwnProperty(propertyName)) { this[propertyName] = properties[propertyName]; }
        }
        if (properties && properties.hasOwnProperty('toString')) { this.toString = properties.toString; }
      },
      clone: function () { return this.init.prototype.extend(this); }
    };
  }());

  var WordArray = C_lib.WordArray = Base.extend({
    init: function (words, sigBytes) {
      words = this.words = words || [];
      this.sigBytes = sigBytes != undefined ? sigBytes : words.length * 4;
    },
    toString: function (encoder) { return (encoder || C.enc.Hex).stringify(this); },
    concat: function (wordArray) {
      var thisWords = this.words;
      var thatWords = wordArray.words;
      var thisSigBytes = this.sigBytes;
      var thatSigBytes = wordArray.sigBytes;
      this.clamp();
      if (thisSigBytes % 4) {
        for (var i = 0; i < thatSigBytes; i++) {
          var thatByte = (thatWords[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
          thisWords[(thisSigBytes + i) >>> 2] |= thatByte << (24 - ((thisSigBytes + i) % 4) * 8);
        }
      } else {
        for (var j = 0; j < thatSigBytes; j += 4) {
          thisWords[(thisSigBytes + j) >>> 2] = thatWords[j >>> 2];
        }
      }
      this.sigBytes += thatSigBytes;
      return this;
    },
    clamp: function () {
      var words = this.words;
      var sigBytes = this.sigBytes;
      words[sigBytes >>> 2] &= 0xffffffff << (32 - (sigBytes % 4) * 8);
      words.length = Math.ceil(sigBytes / 4);
    },
    clone: function () {
      var clone = Base.clone.call(this);
      clone.words = this.words.slice(0);
      return clone;
    }
  });

  var C_enc = C.enc = {};
  C.enc.Hex = {
    stringify: function (wordArray) {
      var words = wordArray.words, sigBytes = wordArray.sigBytes;
      var hexChars = [];
      for (var i = 0; i < sigBytes; i++) {
        var bite = (words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
        hexChars.push((bite >>> 4).toString(16));
        hexChars.push((bite & 0x0f).toString(16));
      }
      return hexChars.join('');
    },
    parse: function (hexStr) {
      var words = [];
      for (var i = 0; i < hexStr.length; i += 2) {
        words[i >>> 3] |= parseInt(hexStr.substr(i, 2), 16) << (24 - (i % 8) * 4);
      }
      return WordArray.create(words, hexStr.length / 2);
    }
  };
  var Latin1 = C.enc.Latin1 = {
    stringify: function (wordArray) {
      var words = wordArray.words, sigBytes = wordArray.sigBytes;
      var latin1Chars = [];
      for (var i = 0; i < sigBytes; i++) {
        var bite = (words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
        latin1Chars.push(String.fromCharCode(bite));
      }
      return latin1Chars.join('');
    },
    parse: function (latin1Str) {
      var words = [];
      for (var i = 0; i < latin1Str.length; i++) {
        words[i >>> 2] |= (latin1Str.charCodeAt(i) & 0xff) << (24 - (i % 4) * 8);
      }
      return WordArray.create(words, latin1Str.length);
    }
  };
  C.enc.Utf8 = {
    stringify: function (wordArray) {
      try { return decodeURIComponent(escape(Latin1.stringify(wordArray))); }
      catch (e) { throw new Error('Malformed UTF-8 data'); }
    },
    parse: function (utf8Str) { return Latin1.parse(unescape(encodeURIComponent(utf8Str))); }
  };

  var BufferedBlockAlgorithm = C_lib.BufferedBlockAlgorithm = Base.extend({
    reset: function () { this._data = WordArray.create(); this._nDataBytes = 0; },
    _append: function (data) { if (typeof data == 'string') { data = C.enc.Utf8.parse(data); } this._data.concat(data); this._nDataBytes += data.sigBytes; },
    _process: function (doFlush) {
      var data = this._data, dataWords = data.words, dataSigBytes = data.sigBytes;
      var blockSize = this.blockSize, blockSizeBytes = blockSize * 4;
      var nBlocksReady = dataSigBytes / blockSizeBytes;
      if (doFlush) { nBlocksReady = Math.ceil(nBlocksReady); }
      else { nBlocksReady = Math.max((nBlocksReady | 0) - this._minBufferSize, 0); }
      var nWordsReady = nBlocksReady * blockSize;
      var nBytesReady = Math.min(nWordsReady * 4, dataSigBytes);
      var processedWords;
      if (nWordsReady) {
        for (var offset = 0; offset < nWordsReady; offset += blockSize) { this._doProcessBlock(dataWords, offset); }
        processedWords = dataWords.splice(0, nWordsReady);
        data.sigBytes -= nBytesReady;
      }
      return WordArray.create(processedWords || [], nBytesReady);
    },
    clone: function () { var clone = Base.clone.call(this); clone._data = this._data.clone(); return clone; },
    _minBufferSize: 0
  });

  var Hasher = C_lib.Hasher = BufferedBlockAlgorithm.extend({
    cfg: Base.extend(),
    init: function (cfg) { this.cfg = this.cfg.extend(cfg); this.reset(); },
    reset: function () { BufferedBlockAlgorithm.reset.call(this); this._doReset(); },
    update: function (messageUpdate) { this._append(messageUpdate); this._process(); return this; },
    finalize: function (messageUpdate) { if (messageUpdate) { this._append(messageUpdate); } var hash = this._doFinalize(); return hash; },
    blockSize: 512/32,
    _createHelper: function (hasher) { return function (message, cfg) { return new hasher.init(cfg).finalize(message); }; },
    _createHmacHelper: function (hasher) { return function (message, key) { return new C.algo.HMAC.init(hasher, key).finalize(message); }; }
  });

  C.algo = {};
  return C;
}(Math));

/* ===== enc-base64.js ===== */
(function () {
  var C = CryptoJS, C_enc = C.enc, WordArray = C.lib.WordArray;
  var map = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
  C_enc.Base64 = {
    stringify: function (wordArray) {
      var words = wordArray.words, sigBytes = wordArray.sigBytes;
      wordArray.clamp();
      var base64Chars = [];
      for (var i = 0; i < sigBytes; i += 3) {
        var byte1 = (words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
        var byte2 = (words[(i + 1) >>> 2] >>> (24 - ((i + 1) % 4) * 8)) & 0xff;
        var byte3 = (words[(i + 2) >>> 2] >>> (24 - ((i + 2) % 4) * 8)) & 0xff;
        var triplet = (byte1 << 16) | (byte2 << 8) | byte3;
        for (var j = 0; j < 4 && i + j * 0.75 < sigBytes; j++) {
          base64Chars.push(map.charAt((triplet >>> (6 * (3 - j))) & 0x3f));
        }
      }
      var paddingChar = map.charAt(64);
      while (base64Chars.length % 4) { base64Chars.push(paddingChar); }
      return base64Chars.join('');
    },
    parse: function (base64Str) {
      var base64StrLength = base64Str.length;
      var words = [], nBytes = 0;
      var paddingIndex = base64Str.indexOf('=');
      if (paddingIndex !== -1) { base64StrLength = paddingIndex; }
      for (var i = 0; i < base64StrLength; i++) {
        if (i % 4) {
          var bits1 = map.indexOf(base64Str.charAt(i - 1)) << ((i % 4) * 2);
          var bits2 = map.indexOf(base64Str.charAt(i)) >>> (6 - (i % 4) * 2);
          words[nBytes >>> 2] |= (bits1 | bits2) << (24 - (nBytes % 4) * 8);
          nBytes++;
        }
      }
      return WordArray.create(words, nBytes);
    }
  };
}());

/* ===== sha256.js ===== */
(function (Math) {
  var C = CryptoJS, C_lib = C.lib, WordArray = C_lib.WordArray, Hasher = C_lib.Hasher, C_algo = C.algo;
  var H = [], K = [];
  (function () {
    function isPrime(n) { var sqrtN = Math.sqrt(n); for (var f = 2; f <= sqrtN; f++) { if (!(n % f)) return false; } return true; }
    function frac(n) { return ((n - (n | 0)) * 0x100000000) | 0; }
    var n = 2, nPrime = 0;
    while (nPrime < 64) { if (isPrime(n)) { if (nPrime < 8) { H[nPrime] = frac(Math.pow(n, 1/2)); } K[nPrime] = frac(Math.pow(n, 1/3)); nPrime++; } n++; }
  }());
  var W = [];
  var SHA256 = C_algo.SHA256 = Hasher.extend({
    _doReset: function () { this._hash = new WordArray.init(H.slice(0)); },
    _doProcessBlock: function (M, offset) {
      var Hh = this._hash.words;
      var a = Hh[0], b = Hh[1], c = Hh[2], d = Hh[3], e = Hh[4], f = Hh[5], g = Hh[6], h = Hh[7];
      for (var i = 0; i < 64; i++) {
        if (i < 16) { W[i] = M[offset + i] | 0; }
        else {
          var gamma0x = W[i - 15], gamma0 = ((gamma0x << 25) | (gamma0x >>> 7)) ^ ((gamma0x << 14) | (gamma0x >>> 18)) ^ (gamma0x >>> 3);
          var gamma1x = W[i - 2],  gamma1 = ((gamma1x << 15) | (gamma1x >>> 17)) ^ ((gamma1x << 13) | (gamma1x >>> 19)) ^ (gamma1x >>> 10);
          W[i] = (W[i - 16] + gamma0 + W[i - 7] + gamma1) | 0;
        }
        var ch = (e & f) ^ (~e & g), maj = (a & b) ^ (a & c) ^ (b & c);
        var sigma0 = ((a << 30) | (a >>> 2)) ^ ((a << 19) | (a >>> 13)) ^ ((a << 10) | (a >>> 22));
        var sigma1 = ((e << 26) | (e >>> 6)) ^ ((e << 21) | (e >>> 11)) ^ ((e << 7) | (e >>> 25));
        var t1 = (h + sigma1 + ch + K[i] + W[i]) | 0;
        var t2 = (sigma0 + maj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      Hh[0] = (Hh[0] + a) | 0; Hh[1] = (Hh[1] + b) | 0; Hh[2] = (Hh[2] + c) | 0; Hh[3] = (Hh[3] + d) | 0;
      Hh[4] = (Hh[4] + e) | 0; Hh[5] = (Hh[5] + f) | 0; Hh[6] = (Hh[6] + g) | 0; Hh[7] = (Hh[7] + h) | 0;
    },
    _doFinalize: function () {
      var data = this._data, dataWords = data.words;
      var nBitsTotal = this._nDataBytes * 8, nBitsLeft = data.sigBytes * 8;
      dataWords[nBitsLeft >>> 5] |= 0x80 << (24 - nBitsLeft % 32);
      dataWords[(((nBitsLeft + 64) >>> 9) << 4) + 14] = Math.floor(nBitsTotal / 0x100000000);
      dataWords[(((nBitsLeft + 64) >>> 9) << 4) + 15] = nBitsTotal;
      data.sigBytes = dataWords.length * 4;
      this._process();
      return this._hash;
    },
    clone: function () { var clone = Hasher.clone.call(this); clone._hash = this._hash.clone(); return clone; }
  });
  C.SHA256 = Hasher._createHelper(SHA256);
}(Math));

/* ===== hmac.js + HmacSHA256 helper ===== */
(function () {
  var C = CryptoJS, C_lib = C.lib, Base = C_lib.Base, C_enc = C.enc, Utf8 = C_enc.Utf8, C_algo = C.algo;
  var HMAC = C_algo.HMAC = Base.extend({
    init: function (hasher, key) {
      this._hasher = new hasher.init();
      if (typeof key == 'string') { key = Utf8.parse(key); }
      var hasherBlockSize = this._hasher.blockSize;
      var hasherBlockSizeBytes = hasherBlockSize * 4;
      if (key.sigBytes > hasherBlockSizeBytes) { key = this._hasher.finalize(key); }
      key.clamp();
      var oKey = this._oKey = key.clone();
      var iKey = this._iKey = key.clone();
      var oKeyWords = oKey.words, iKeyWords = iKey.words;
      for (var i = 0; i < hasherBlockSize; i++) { oKeyWords[i] ^= 0x5c5c5c5c; iKeyWords[i] ^= 0x36363636; }
      oKey.sigBytes = iKey.sigBytes = hasherBlockSizeBytes;
      this.reset();
    },
    reset: function () { var hasher = this._hasher; hasher.reset(); hasher.update(this._iKey); },
    update: function (messageUpdate) { this._hasher.update(messageUpdate); return this; },
    finalize: function (messageUpdate) {
      var hasher = this._hasher;
      var innerHash = hasher.finalize(messageUpdate);
      hasher.reset();
      return hasher.finalize(this._oKey.clone().concat(innerHash));
    }
  });
  C.HmacSHA256 = C_lib.Hasher._createHmacHelper(C.algo.SHA256);
}());

/* ===== pbkdf2.js (with SHA-256 default) ===== */
(function () {
  var C = CryptoJS, C_lib = C.lib, Base = C_lib.Base, WordArray = C_lib.WordArray, C_algo = C.algo, HMAC = C_algo.HMAC;
  var PBKDF2 = C_algo.PBKDF2 = Base.extend({
    cfg: Base.extend({ keySize: 64/32, hasher: C.algo.SHA256, iterations: 1 }),
    init: function (cfg) { this.cfg = this.cfg.extend(cfg); },
    compute: function (password, salt) {
      var cfg = this.cfg;
      var hmac = HMAC.create(cfg.hasher, password);
      var derivedKey = WordArray.create();
      var blockIndex = WordArray.create([0x00000001]);
      var derivedKeyWords = derivedKey.words;
      var keySize = cfg.keySize, iterations = cfg.iterations;
      while (derivedKeyWords.length < keySize) {
        var block = hmac.update(salt).finalize(blockIndex); hmac.reset();
        var blockWords = block.words, blockWordsLength = blockWords.length;
        var intermediate = block;
        for (var i = 1; i < iterations; i++) {
          intermediate = hmac.finalize(intermediate); hmac.reset();
          var intermediateWords = intermediate.words;
          for (var j = 0; j < blockWordsLength; j++) { blockWords[j] ^= intermediateWords[j]; }
        }
        derivedKey.concat(block); blockIndex.words[0]++;
      }
      derivedKey.sigBytes = keySize * 4; return derivedKey;
    }
  });
  C.PBKDF2 = function (password, salt, cfg) { return PBKDF2.create(cfg).compute(password, salt); };
}());

/* ===== cipher-core.js (CBC + PKCS7 included) ===== */
CryptoJS.lib.Cipher || (function () {
  var C = CryptoJS, C_lib = C.lib, Base = C_lib.Base, WordArray = C_lib.WordArray, BufferedBlockAlgorithm = C_lib.BufferedBlockAlgorithm, C_enc = C.enc;
  var Cipher = C_lib.Cipher = BufferedBlockAlgorithm.extend({
    cfg: Base.extend(),
    createEncryptor: function (key, cfg) { return this.create(this._ENC_XFORM_MODE, key, cfg); },
    createDecryptor: function (key, cfg) { return this.create(this._DEC_XFORM_MODE, key, cfg); },
    init: function (xformMode, key, cfg) { this.cfg = this.cfg.extend(cfg); this._xformMode = xformMode; this._key = key; this.reset(); },
    reset: function () { BufferedBlockAlgorithm.reset.call(this); this._doReset(); },
    process: function (dataUpdate) { this._append(dataUpdate); return this._process(); },
    finalize: function (dataUpdate) { if (dataUpdate) { this._append(dataUpdate); } return this._doFinalize(); },
    keySize: 128/32, ivSize: 128/32, _ENC_XFORM_MODE: 1, _DEC_XFORM_MODE: 2,
    _createHelper: (function () {
      return function (cipher) { return {
        encrypt: function (message, key, cfg) { return SerializableCipher.encrypt(cipher, message, key, cfg); },
        decrypt: function (ciphertext, key, cfg) { return SerializableCipher.decrypt(cipher, ciphertext, key, cfg); }
      }; };
    }())
  });

  var StreamCipher = C_lib.StreamCipher = Cipher.extend({
    _doFinalize: function () { return this._process(!!'flush'); }, blockSize: 1
  });

  var C_mode = C.mode = {};
  var BlockCipherMode = C_lib.BlockCipherMode = Base.extend({
    createEncryptor: function (cipher, iv) { return this.Encryptor.create(cipher, iv); },
    createDecryptor: function (cipher, iv) { return this.Decryptor.create(cipher, iv); },
    init: function (cipher, iv) { this._cipher = cipher; this._iv = iv; }
  });

  var CBC = C_mode.CBC = (function () {
    var CBC = BlockCipherMode.extend();
    CBC.Encryptor = CBC.extend({
      processBlock: function (words, offset) {
        var cipher = this._cipher, blockSize = cipher.blockSize;
        xorBlock.call(this, words, offset, blockSize);
        cipher.encryptBlock(words, offset);
        this._prevBlock = words.slice(offset, offset + blockSize);
      }
    });
    CBC.Decryptor = CBC.extend({
      processBlock: function (words, offset) {
        var cipher = this._cipher, blockSize = cipher.blockSize;
        var thisBlock = words.slice(offset, offset + blockSize);
        cipher.decryptBlock(words, offset);
        xorBlock.call(this, words, offset, blockSize);
        this._prevBlock = thisBlock;
      }
    });
    function xorBlock(words, offset, blockSize) {
      var block;
      if (this._iv) { block = this._iv; this._iv = undefined; }
      else { block = this._prevBlock; }
      for (var i = 0; i < blockSize; i++) { words[offset + i] ^= block[i]; }
    }
    return CBC;
  }());

  var C_pad = C.pad = {};
  var Pkcs7 = C_pad.Pkcs7 = {
    pad: function (data, blockSize) {
      var blockSizeBytes = blockSize * 4;
      var nPaddingBytes = blockSizeBytes - data.sigBytes % blockSizeBytes;
      var paddingWord = (nPaddingBytes << 24) | (nPaddingBytes << 16) | (nPaddingBytes << 8) | nPaddingBytes;
      var paddingWords = [];
      for (var i = 0; i < nPaddingBytes; i += 4) { paddingWords.push(paddingWord); }
      var padding = WordArray.create(paddingWords, nPaddingBytes);
      data.concat(padding);
    },
    unpad: function (data) { var nPaddingBytes = data.words[(data.sigBytes - 1) >>> 2] & 0xff; data.sigBytes -= nPaddingBytes; }
  };

  var BlockCipher = C_lib.BlockCipher = Cipher.extend({
    cfg: Cipher.cfg.extend({ mode: CBC, padding: Pkcs7 }),
    reset: function () {
      Cipher.reset.call(this);
      var cfg = this.cfg, iv = cfg.iv, mode = cfg.mode;
      var modeCreator = (this._xformMode == this._ENC_XFORM_MODE) ? mode.createEncryptor : mode.createDecryptor;
      this._mode = modeCreator.call(mode, this, iv && iv.words);
      if (this._xformMode == this._DEC_XFORM_MODE) { this._minBufferSize = 1; }
    },
    _doProcessBlock: function (words, offset) { this._mode.processBlock(words, offset); },
    _doFinalize: function () {
      var padding = this.cfg.padding, finalProcessedBlocks;
      if (this._xformMode == this._ENC_XFORM_MODE) { padding.pad(this._data, this.blockSize); finalProcessedBlocks = this._process(!!'flush'); }
      else { finalProcessedBlocks = this._process(!!'flush'); padding.unpad(finalProcessedBlocks); }
      return finalProcessedBlocks;
    },
    blockSize: 128/32
  });

  var C_format = C.format = {};
  var OpenSSLFormatter = C_format.OpenSSL = {
    stringify: function (cipherParams) {
      var ciphertext = cipherParams.ciphertext, salt = cipherParams.salt, Base64 = C_enc.Base64;
      var wordArray;
      if (salt) { wordArray = WordArray.create([0x53616c74, 0x65645f5f]).concat(salt).concat(ciphertext); }
      else { wordArray = ciphertext; }
      return wordArray.toString(Base64);
    },
    parse: function (openSSLStr) {
      var ciphertext = C_enc.Base64.parse(openSSLStr);
      var ciphertextWords = ciphertext.words, salt;
      if (ciphertextWords[0] == 0x53616c74 && ciphertextWords[1] == 0x65645f5f) {
        salt = WordArray.create(ciphertextWords.slice(2, 4));
        ciphertextWords.splice(0, 4); ciphertext.sigBytes -= 16;
      }
      return C_lib.CipherParams.create({ ciphertext: ciphertext, salt: salt });
    }
  };

  var SerializableCipher = C_lib.SerializableCipher = Base.extend({
    cfg: Base.extend({ format: OpenSSLFormatter }),
    encrypt: function (cipher, message, key, cfg) {
      cfg = this.cfg.extend(cfg);
      var encryptor = cipher.createEncryptor(key, cfg);
      var ciphertext = encryptor.finalize(message);
      var cipherCfg = encryptor.cfg;
      return C_lib.CipherParams.create({
        ciphertext: ciphertext, key: key, iv: cipherCfg.iv, algorithm: cipher, mode: cipherCfg.mode,
        padding: cipherCfg.padding, blockSize: cipher.blockSize, formatter: cfg.format
      });
    },
    decrypt: function (cipher, ciphertext, key, cfg) {
      cfg = this.cfg.extend(cfg);
      ciphertext = this._parse(ciphertext, cfg.format);
      return cipher.createDecryptor(key, cfg).finalize(ciphertext.ciphertext);
    },
    _parse: function (ciphertext, format) { return (typeof ciphertext == 'string') ? format.parse(ciphertext, this) : ciphertext; }
  });

  var C_kdf = C.kdf = {};
  // (OpenSSL KDF omitted; not used by our Code.gs)
}());

/* ===== aes.js ===== */
(function () {
  var C = CryptoJS, C_lib = C.lib, BlockCipher = C_lib.BlockCipher, C_algo = C.algo;
  var SBOX = [], INV_SBOX = [], SUB_MIX_0 = [], SUB_MIX_1 = [], SUB_MIX_2 = [], SUB_MIX_3 = [], INV_SUB_MIX_0 = [], INV_SUB_MIX_1 = [], INV_SUB_MIX_2 = [], INV_SUB_MIX_3 = [];
  (function () {
    var d = [], i;
    for (i = 0; i < 256; i++) { d[i] = (i < 128) ? (i << 1) : ((i << 1) ^ 0x11b); }
    var x = 0, xi = 0;
    for (i = 0; i < 256; i++) {
      var sx = xi ^ (xi << 1) ^ (xi << 2) ^ (xi << 3) ^ (xi << 4); sx = (sx >>> 8) ^ (sx & 0xff) ^ 0x63;
      SBOX[x] = sx; INV_SBOX[sx] = x;
      var x2 = d[x], x4 = d[x2], x8 = d[x4], t = (d[sx] * 0x101) ^ (sx * 0x1010100);
      SUB_MIX_0[x] = (t << 24) | (t >>> 8); SUB_MIX_1[x] = (t << 16) | (t >>> 16); SUB_MIX_2[x] = (t << 8) | (t >>> 24); SUB_MIX_3[x] = t;
      t = (x8 * 0x1010101) ^ (x4 * 0x10001) ^ (x2 * 0x101) ^ (x * 0x1010100);
      INV_SUB_MIX_0[sx] = (t << 24) | (t >>> 8); INV_SUB_MIX_1[sx] = (t << 16) | (t >>> 16); INV_SUB_MIX_2[sx] = (t << 8) | (t >>> 24); INV_SUB_MIX_3[sx] = t;
      if (!x) { x = xi = 1; } else { x = x2 ^ d[d[d[x8 ^ x2]]]; xi ^= d[d[xi]]; }
    }
  }());
  var RCON = [0x00, 0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];

  var AES = C_algo.AES = BlockCipher.extend({
    _doReset: function () {
      var key = this._key, keyWords = key.words, keySize = key.sigBytes / 4;
      var nRounds = this._nRounds = keySize + 6;
      var ksRows = (nRounds + 1) * 4;
      var keySchedule = this._keySchedule = [];
      for (var ksRow = 0; ksRow < ksRows; ksRow++) {
        if (ksRow < keySize) { keySchedule[ksRow] = keyWords[ksRow]; }
        else {
          var t = keySchedule[ksRow - 1];
          if (!(ksRow % keySize)) {
            t = (t << 8) | (t >>> 24);
            t = (SBOX[t >>> 24] << 24) | (SBOX[(t >>> 16) & 0xff] << 16) | (SBOX[(t >>> 8) & 0xff] << 8) | SBOX[t & 0xff];
            t ^= RCON[(ksRow / keySize) | 0] << 24;
          } else if (keySize > 6 && ksRow % keySize == 4) {
            t = (SBOX[t >>> 24] << 24) | (SBOX[(t >>> 16) & 0xff] << 16) | (SBOX[(t >>> 8) & 0xff] << 8) | SBOX[t & 0xff];
          }
          keySchedule[ksRow] = keySchedule[ksRow - keySize] ^ t;
        }
      }
      var invKeySchedule = this._invKeySchedule = [];
      for (var invKsRow = 0; invKsRow < ksRows; invKsRow++) {
        var ksRow = ksRows - invKsRow;
        var t2 = (invKsRow % 4) ? keySchedule[ksRow] : keySchedule[ksRow - 4];
        invKeySchedule[invKsRow] = (invKsRow < 4 || ksRow <= 4) ? t2 :
          (INV_SUB_MIX_0[SBOX[t2 >>> 24]] ^ INV_SUB_MIX_1[SBOX[(t2 >>> 16) & 0xff]] ^
           INV_SUB_MIX_2[SBOX[(t2 >>> 8) & 0xff]] ^ INV_SUB_MIX_3[SBOX[t2 & 0xff]]);
      }
    },
    encryptBlock: function (M, offset) { this._doCryptBlock(M, offset, this._keySchedule,  SUB_MIX_0,  SUB_MIX_1,  SUB_MIX_2,  SUB_MIX_3,  SBOX); },
    decryptBlock: function (M, offset) {
      var t = M[offset + 1]; M[offset + 1] = M[offset + 3]; M[offset + 3] = t;
      this._doCryptBlock(M, offset, this._invKeySchedule, INV_SUB_MIX_0, INV_SUB_MIX_1, INV_SUB_MIX_2, INV_SUB_MIX_3, INV_SBOX);
      t = M[offset + 1]; M[offset + 1] = M[offset + 3]; M[offset + 3] = t;
    },
    _doCryptBlock: function (M, offset, keySchedule, SUB0, SUB1, SUB2, SUB3, SBOX_) {
      var nRounds = this._nRounds, s0 = M[offset] ^ keySchedule[0], s1 = M[offset+1] ^ keySchedule[1], s2 = M[offset+2] ^ keySchedule[2], s3 = M[offset+3] ^ keySchedule[3], ksRow = 4;
      for (var round = 1; round < nRounds; round++) {
        var t0 = SUB0[s0 >>> 24] ^ SUB1[(s1 >>> 16) & 0xff] ^ SUB2[(s2 >>> 8) & 0xff] ^ SUB3[s3 & 0xff] ^ keySchedule[ksRow++];
        var t1 = SUB0[s1 >>> 24] ^ SUB1[(s2 >>> 16) & 0xff] ^ SUB2[(s3 >>> 8) & 0xff] ^ SUB3[s0 & 0xff] ^ keySchedule[ksRow++];
        var t2 = SUB0[s2 >>> 24] ^ SUB1[(s3 >>> 16) & 0xff] ^ SUB2[(s0 >>> 8) & 0xff] ^ SUB3[s1 & 0xff] ^ keySchedule[ksRow++];
        var t3 = SUB0[s3 >>> 24] ^ SUB1[(s0 >>> 16) & 0xff] ^ SUB2[(s1 >>> 8) & 0xff] ^ SUB3[s2 & 0xff] ^ keySchedule[ksRow++];
        s0 = t0; s1 = t1; s2 = t2; s3 = t3;
      }
      var t0f = ((SBOX_[s0 >>> 24] << 24) | (SBOX_[(s1 >>> 16) & 0xff] << 16) | (SBOX_[(s2 >>> 8) & 0xff] << 8) | SBOX_[s3 & 0xff]) ^ keySchedule[ksRow++];
      var t1f = ((SBOX_[s1 >>> 24] << 24) | (SBOX_[(s2 >>> 16) & 0xff] << 16) | (SBOX_[(s3 >>> 8) & 0xff] << 8) | SBOX_[s0 & 0xff]) ^ keySchedule[ksRow++];
      var t2f = ((SBOX_[s2 >>> 24] << 24) | (SBOX_[(s3 >>> 16) & 0xff] << 16) | (SBOX_[(s0 >>> 8) & 0xff] << 8) | SBOX_[s1 & 0xff]) ^ keySchedule[ksRow++];
      var t3f = ((SBOX_[s3 >>> 24] << 24) | (SBOX_[(s0 >>> 16) & 0xff] << 16) | (SBOX_[(s1 >>> 8) & 0xff] << 8) | SBOX_[s2 & 0xff]) ^ keySchedule[ksRow++];
      M[offset] = t0f; M[offset+1] = t1f; M[offset+2] = t2f; M[offset+3] = t3f;
    },
    keySize: 256/32
  });
  C.AES = C_lib.Cipher._createHelper(AES);
}());

/* ===== self-test (optional; safe to keep) ===== */
function _testCryptoJSReady() {
  if (typeof CryptoJS === "undefined") { throw new Error("CryptoJS not loaded"); }
  var h = CryptoJS.SHA256("hello").toString();
  Logger.log(h); // expect 2cf24d... if OK
}
