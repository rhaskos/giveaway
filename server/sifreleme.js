const crypto = require('crypto');

// Admin panelinde kullanici sifrelerini gosterebilmek icin GERI DONDURULEBILIR
// sifreleme (AES-256-GCM). Bu, giris kontrolunde kullanilan bcrypt hash'in
// YERINE degil, YANINDA calisir - giris hala hash ile dogrulanir.
// UYARI: Bu, sifreleri tek yonlu hash'lemekten daha risklidir; ENCRYPTION_KEY
// ve veritabani ele gecirilirse kullanici sifreleri acilabilir.

const anahtarHex = process.env.ENCRYPTION_KEY;
if (!anahtarHex || anahtarHex.length !== 64) {
  console.error('HATA: .env dosyasinda 64 karakterlik (32 byte, hex) bir ENCRYPTION_KEY ayarlanmamis.');
  console.error('Uretmek icin: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  process.exit(1);
}
const anahtar = Buffer.from(anahtarHex, 'hex');

function sifrele(duzMetin) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', anahtar, iv);
  const sifreliVeri = Buffer.concat([cipher.update(duzMetin, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, sifreliVeri]).toString('base64');
}

function cozumle(sifreliMetin) {
  const veri = Buffer.from(sifreliMetin, 'base64');
  const iv = veri.subarray(0, 12);
  const tag = veri.subarray(12, 28);
  const sifreliVeri = veri.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', anahtar, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(sifreliVeri), decipher.final()]).toString('utf8');
}

module.exports = { sifrele, cozumle };
