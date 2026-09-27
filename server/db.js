const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const db = new DatabaseSync(path.join(__dirname, 'veri.sqlite'));
db.exec('PRAGMA journal_mode = WAL;');

db.exec(`
  CREATE TABLE IF NOT EXISTS kullanicilar (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    sifre_hash TEXT NOT NULL,
    sifre_sifreli TEXT,
    dogrulandi INTEGER NOT NULL DEFAULT 0,
    odul_verildi INTEGER NOT NULL DEFAULT 0,
    olusturulma_tarihi TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS dogrulama_kodlari (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kullanici_id_fk INTEGER NOT NULL REFERENCES kullanicilar(id) ON DELETE CASCADE,
    kod_sifreli TEXT NOT NULL,
    son_kullanma INTEGER NOT NULL,
    deneme_sayisi INTEGER NOT NULL DEFAULT 0,
    olusturulma INTEGER NOT NULL
  );
`);

module.exports = db;
