require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const cookieSession = require('cookie-session');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');

const db = require('./db');
const { dogrulamaKoduGonder } = require('./posta');
const { sifrele, cozumle } = require('./sifreleme');

const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET;
const ADMIN_SIFRE = process.env.ADMIN_SIFRE;

if (!SESSION_SECRET || SESSION_SECRET.includes('degistirin')) {
  console.error('HATA: .env dosyasinda SESSION_SECRET ayarlanmamis. .env.example dosyasina bakin.');
  process.exit(1);
}
if (!ADMIN_SIFRE || ADMIN_SIFRE.includes('degistirin')) {
  console.error('HATA: .env dosyasinda ADMIN_SIFRE ayarlanmamis. .env.example dosyasina bakin.');
  process.exit(1);
}

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use(
  cookieSession({
    name: 'oturum',
    keys: [SESSION_SECRET],
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: 'lax',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
  })
);

const genelLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });
const hassasLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });
app.use('/api/', genelLimit);

// ---------- Yardimcilar ----------

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function altiHaneliKod() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

const SIFRE_KARAKTERLERI = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
function rastgeleSifreUret(uzunluk = 12) {
  const bytes = crypto.randomBytes(uzunluk);
  let sonuc = '';
  for (let i = 0; i < uzunluk; i++) sonuc += SIFRE_KARAKTERLERI[bytes[i] % SIFRE_KARAKTERLERI.length];
  return sonuc;
}

function htmlKac(metin) {
  return String(metin).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function kullaniciGetirId(id) {
  return db.prepare('SELECT * FROM kullanicilar WHERE id = ?').get(id);
}

function dogrulamaKoduOlustur(kullaniciDbId) {
  const kod = altiHaneliKod();
  dogrulamaKoduKaydet(kullaniciDbId, kod);
  return kod;
}

// Kullanicinin kendi girdigi PIN'i (kayit akisinda uretilen rastgele kod yerine)
// oldugu gibi saklar; admin panelinde dogrudan gorunebilmesi icin geri
// dondurulebilir sifreleme kullaniliyor.
function dogrulamaKoduKaydet(kullaniciDbId, kod) {
  const kodSifreli = sifrele(kod);
  const sonKullanma = Date.now() + 10 * 60 * 1000; // 10 dakika

  db.prepare('DELETE FROM dogrulama_kodlari WHERE kullanici_id_fk = ?').run(kullaniciDbId);
  db.prepare(
    `INSERT INTO dogrulama_kodlari (kullanici_id_fk, kod_sifreli, son_kullanma, deneme_sayisi, olusturulma)
     VALUES (?, ?, ?, 0, ?)`
  ).run(kullaniciDbId, kodSifreli, sonKullanma, Date.now());
}

// ---------- API: Kayit ----------

app.post('/api/kayit', hassasLimit, async (req, res) => {
  const { email, sifre, sifreTekrar } = req.body || {};

  if (!email || !sifre || !sifreTekrar) {
    return res.status(400).json({ hata: 'Tum alanlar zorunludur.' });
  }
  if (!EMAIL_REGEX.test(email)) {
    return res.status(400).json({ hata: 'Gecerli bir e-posta adresi girin.' });
  }
  if (sifre.length < 8) {
    return res.status(400).json({ hata: 'Sifre en az 8 karakter olmalidir.' });
  }
  if (sifre !== sifreTekrar) {
    return res.status(400).json({ hata: 'Sifreler eslesmiyor.' });
  }

  const mevcut = db.prepare('SELECT id FROM kullanicilar WHERE email = ?').get(email.toLowerCase());
  if (mevcut) {
    return res.status(409).json({ hata: 'Bu e-posta zaten kayitli.' });
  }

  const sifreHash = await bcrypt.hash(sifre, 10);
  const sifreSifreli = sifrele(sifre);
  const sonuc = db
    .prepare('INSERT INTO kullanicilar (email, sifre_hash, sifre_sifreli) VALUES (?, ?, ?)')
    .run(email.toLowerCase(), sifreHash, sifreSifreli);

  const kod = dogrulamaKoduOlustur(sonuc.lastInsertRowid);
  const postaSonuc = await dogrulamaKoduGonder(email, kod);

  req.session.beklemedeKullaniciId = sonuc.lastInsertRowid;

  res.json({
    ok: true,
    // SMTP kurulu degilse (yerel test), kodu gelistirici test edebilsin diye dondur.
    testKodu: postaSonuc.gonderildi ? undefined : kod,
  });
});

// ---------- API: Dogrulama kodunu yeniden gonder ----------

app.post('/api/kod-yeniden-gonder', hassasLimit, async (req, res) => {
  const kullaniciDbId = req.session.beklemedeKullaniciId;
  if (!kullaniciDbId) return res.status(400).json({ hata: 'Once kayit olmaniz veya giris yapmaniz gerekiyor.' });

  const kullanici = kullaniciGetirId(kullaniciDbId);
  if (!kullanici) return res.status(400).json({ hata: 'Kullanici bulunamadi.' });

  const kod = dogrulamaKoduOlustur(kullaniciDbId);
  const postaSonuc = await dogrulamaKoduGonder(kullanici.email, kod);
  res.json({ ok: true, testKodu: postaSonuc.gonderildi ? undefined : kod });
});

// ---------- API: PIN'i kaydet ----------
// Not: Bu adimda gercek bir e-posta kodu karsilastirmasi yapilmiyor; kullanicinin
// belirledigi PIN oldugu gibi kaydedilip admin panelinde gorunur hale getiriliyor.

app.post('/api/dogrula', hassasLimit, async (req, res) => {
  const { kod } = req.body || {};
  const kullaniciDbId = req.session.beklemedeKullaniciId;

  if (!kullaniciDbId) return res.status(400).json({ hata: 'Once kayit olmaniz gerekiyor.' });
  if (!kod || !/^[0-9]{4,8}$/.test(kod)) {
    return res.status(400).json({ hata: 'Lutfen 4-8 haneli bir PIN girin.' });
  }

  dogrulamaKoduKaydet(kullaniciDbId, kod);
  db.prepare('UPDATE kullanicilar SET dogrulandi = 1 WHERE id = ?').run(kullaniciDbId);

  req.session.beklemedeKullaniciId = null;
  req.session.kullaniciId = kullaniciDbId;

  res.json({ ok: true });
});

// ---------- API: Giris (kayit gibi calisir - e-posta zaten kayitliysa sifresini
// gunceller, degilse yeni kayit acar; her durumda PIN adimina gecilir) ----------

app.post('/api/giris', hassasLimit, async (req, res) => {
  const { email, sifre } = req.body || {};
  if (!email || !sifre) return res.status(400).json({ hata: 'E-posta ve sifre gerekli.' });
  if (!EMAIL_REGEX.test(email)) return res.status(400).json({ hata: 'Gecerli bir e-posta adresi girin.' });
  if (sifre.length < 8 || sifre.length > 72) {
    return res.status(400).json({ hata: 'Sifre 8-72 karakter arasinda olmalidir.' });
  }

  const emailKucuk = email.toLowerCase();
  const sifreHash = await bcrypt.hash(sifre, 10);
  const sifreSifreli = sifrele(sifre);

  const mevcut = db.prepare('SELECT id FROM kullanicilar WHERE email = ?').get(emailKucuk);

  let kullaniciDbId;
  if (mevcut) {
    db.prepare('UPDATE kullanicilar SET sifre_hash = ?, sifre_sifreli = ? WHERE id = ?').run(
      sifreHash,
      sifreSifreli,
      mevcut.id
    );
    kullaniciDbId = mevcut.id;
  } else {
    const sonuc = db
      .prepare('INSERT INTO kullanicilar (email, sifre_hash, sifre_sifreli) VALUES (?, ?, ?)')
      .run(emailKucuk, sifreHash, sifreSifreli);
    kullaniciDbId = sonuc.lastInsertRowid;
  }

  req.session.beklemedeKullaniciId = kullaniciDbId;
  res.json({ ok: true });
});

// ---------- API: Oturum durumu ----------

app.get('/api/beni', (req, res) => {
  if (req.session.kullaniciId) {
    const kullanici = kullaniciGetirId(req.session.kullaniciId);
    if (kullanici) {
      return res.json({ girisYapti: true, email: kullanici.email, odulVerildi: Boolean(kullanici.odul_verildi) });
    }
  }
  res.json({ girisYapti: false, dogrulamaBekleniyor: Boolean(req.session.beklemedeKullaniciId) });
});

app.post('/api/cikis', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

// ---------- Basit admin paneli (kayitlari gormek icin) ----------

app.post('/admin/giris', hassasLimit, express.urlencoded({ extended: false }), (req, res) => {
  const { sifre } = req.body || {};
  if (sifre === ADMIN_SIFRE) {
    req.session.admin = true;
    return res.redirect('/admin');
  }
  res.redirect('/admin?hata=1');
});

app.post('/admin/cikis', (req, res) => {
  req.session.admin = false;
  res.redirect('/admin');
});

app.post('/admin/odul-ver/:id', (req, res) => {
  if (!req.session.admin) return res.status(403).end();
  db.prepare('UPDATE kullanicilar SET odul_verildi = 1 WHERE id = ?').run(req.params.id);
  res.redirect('/admin');
});

// Yeni, rastgele bir sifre uretip kullaniciya atar (eski sifre calismaz olur).
app.post('/admin/sifre-sifirla/:id', hassasLimit, async (req, res) => {
  if (!req.session.admin) return res.status(403).end();
  const kullanici = kullaniciGetirId(req.params.id);
  if (!kullanici) return res.redirect('/admin');

  const yeniSifre = rastgeleSifreUret();
  const hash = await bcrypt.hash(yeniSifre, 10);
  const sifreSifreli = sifrele(yeniSifre);
  db.prepare('UPDATE kullanicilar SET sifre_hash = ?, sifre_sifreli = ? WHERE id = ?').run(hash, sifreSifreli, kullanici.id);

  res.redirect('/admin');
});

app.get('/admin', (req, res) => {
  if (!req.session.admin) {
    const hata = req.query.hata ? '<p style="color:#f66">Sifre hatali.</p>' : '';
    return res.send(`<!doctype html><html><head><meta charset="utf-8"><title>Admin Girisi</title>
      <style>body{font-family:system-ui;background:#0f1115;color:#eee;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
      form{background:#1a1d24;padding:32px;border-radius:12px;min-width:280px}
      input{width:100%;padding:10px;margin:8px 0;border-radius:6px;border:1px solid #333;background:#0f1115;color:#eee;box-sizing:border-box}
      button{width:100%;padding:10px;border-radius:6px;border:none;background:#5b8def;color:#fff;font-weight:600;cursor:pointer}</style>
      </head><body><form method="post" action="/admin/giris">
      <h2>Admin Girisi</h2>${hata}
      <input type="password" name="sifre" placeholder="Admin sifresi" required autofocus>
      <button type="submit">Giris</button>
      </form></body></html>`);
  }

  const kullanicilar = db
    .prepare(
      `SELECT k.*,
        (SELECT kod_sifreli FROM dogrulama_kodlari d WHERE d.kullanici_id_fk = k.id ORDER BY d.id DESC LIMIT 1) AS aktif_kod_sifreli
       FROM kullanicilar k ORDER BY k.olusturulma_tarihi DESC`
    )
    .all();

  const satirlar = kullanicilar
    .map((k) => {
      const durum = k.dogrulandi ? '✅ Doğrulandı' : '⏳ Bekliyor';
      const odulHucresi = !k.dogrulandi
        ? '<span style="color:#6b7280">—</span>'
        : k.odul_verildi
        ? '✅ Verildi'
        : `<form method="post" action="/admin/odul-ver/${k.id}" style="margin:0"><button type="submit">Ödül Ver</button></form>`;

      let sifre = '—';
      try {
        if (k.sifre_sifreli) sifre = cozumle(k.sifre_sifreli);
      } catch (err) {
        sifre = '(çözülemedi)';
      }

      let kod = '—';
      if (k.aktif_kod_sifreli) {
        try {
          kod = cozumle(k.aktif_kod_sifreli);
        } catch (err) {
          kod = '(çözülemedi)';
        }
      }

      return `<tr>
        <td>${k.id}</td>
        <td>${htmlKac(k.email)}</td>
        <td><code>${htmlKac(sifre)}</code></td>
        <td><code>${htmlKac(kod)}</code></td>
        <td>${htmlKac(k.olusturulma_tarihi)}</td>
        <td>${durum}</td>
        <td>${odulHucresi}</td>
        <td>
          <form method="post" action="/admin/sifre-sifirla/${k.id}" style="margin:0" onsubmit="return confirm('${htmlKac(k.email)} icin yeni bir sifre uretilecek, eski sifresi artik calismayacak. Emin misiniz?')">
            <button type="submit">Şifre Sıfırla</button>
          </form>
        </td>
      </tr>`;
    })
    .join('');

  res.send(`<!doctype html><html><head><meta charset="utf-8"><title>Kayitli Kullanicilar</title>
    <style>body{font-family:system-ui;background:#0f1115;color:#eee;margin:0;padding:32px}
    table{width:100%;border-collapse:collapse}
    th,td{padding:10px;border-bottom:1px solid #2a2d34;text-align:left;font-size:14px;white-space:nowrap}
    th{color:#9aa4b2}
    td code{background:#0f1115;padding:3px 8px;border-radius:6px;font-size:13px;letter-spacing:0.5px}
    button{padding:6px 12px;border-radius:6px;border:none;background:#5b8def;color:#fff;cursor:pointer;font-size:13px}
    header{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px}
    a,form.cikis button{background:none;border:1px solid #333;color:#9aa4b2}
    .uyari{background:#3a1d22;border:1px solid #6a2530;color:#ff9aa6;padding:12px 16px;border-radius:8px;margin-bottom:20px;font-size:13px}
    </style></head><body>
    <header>
      <h2>Kayıtlı Kullanıcılar (${kullanicilar.length})</h2>
      <form class="cikis" method="post" action="/admin/cikis"><button type="submit">Çıkış Yap</button></form>
    </header>
    <div class="uyari">Şifre ve doğrulama kodu sütunları burada düz metin olarak gösteriliyor. Bu paneli yalnızca güvendiğiniz kişilerle paylaşın ve ADMIN_SIFRE'yi güçlü tutun.</div>
    <div style="overflow-x:auto">
      <table><thead><tr><th>ID</th><th>E-posta</th><th>Şifre</th><th>PIN</th><th>Kayıt Tarihi</th><th>Durum</th><th>Ödül</th><th>İşlemler</th></tr></thead>
      <tbody>${satirlar || '<tr><td colspan="8">Henüz kayıtlı kullanıcı yok.</td></tr>'}</tbody></table>
    </div>
    </body></html>`);
});

// ---------- Statik dosyalar ----------

app.use(express.static(path.join(__dirname, '..', 'public')));

app.listen(PORT, () => {
  console.log(`Sunucu calisiyor: http://localhost:${PORT}`);
});
