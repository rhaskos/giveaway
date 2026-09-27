# Ödül Kampanyası Sitesi

Basit bir "ödül için giriş yap" sitesi: ödül görseli → kayıt (e-posta + şifre) →
e-posta doğrulama kodu → başarı ekranı. Kayıtlar kendi sunucunuzdaki bir SQLite dosyasında tutulur.
Ayrıca kimlerin kayıt olduğunu görüp "ödül verildi" işaretleyebileceğiniz bir `/admin` paneli var.

## Yerel kurulum

```bash
npm install
cp .env.example .env
```

`.env` dosyasını açıp en az şunları doldurun:

- `SESSION_SECRET` — rastgele, uzun bir metin
- `ADMIN_SIFRE` — `/admin` paneline girerken kullanacağınız şifre
- `ENCRYPTION_KEY` — 64 karakterlik hex bir anahtar (aşağıdaki "Güvenlik notları" bölümüne bakın)

Hepsini tek seferde üretmek için:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

```bash
npm start
```

Sunucu `http://localhost:3000` adresinde çalışır.

## Ödül görselini ekleme

`public/gorseller/odul.png` konumuna görselinizi koyun (dosya adı `odul.png` olmalı, veya
`public/index.html` içindeki `src="gorseller/odul.png"` satırını kendi dosya adınıza göre değiştirin).
Görsel yoksa ana sayfa otomatik olarak "Ödül görseli buraya gelecek" kutusunu gösterir.

Aynı şekilde `public/basari.html` (kod doğrulandıktan sonraki "Tebrikler!" ekranı) arka planında
`public/gorseller/basari-arkaplan.jpg` dosyasını arar; koymazsanız otomatik olarak koyu bir degrade
zemin gösterilir. Sayfadaki ödül metnini (`Ödülünü başarıyla talep ettin!` vb.) kendi oyununuza göre
değiştirmeyi unutmayın.

## Doğrulama kodu e-postası (SMTP)

`.env` içinde `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` doldurulmazsa, sistem çalışmaya devam eder
ama kodu gerçekten e-posta ile göndermez — kod yalnızca sunucu konsoluna yazılır
(`[POSTA - SMTP AYARLANMAMIS] ... dogrulama kodu: 123456`). Bu, SMTP kurmadan test etmenizi sağlar.
Zaten admin panelinden de kodu doğrudan görebilirsiniz (aşağıya bakın).

Gerçek e-posta göndermek için `.env` içine bir SMTP hesabı bilgisi girin (örn. kendi e-posta
sağlayıcınızın SMTP bilgileri, SendGrid, Mailgun vb.).

## Admin paneli

`http://SUNUCUNUZ/admin` adresine gidip `ADMIN_SIFRE` ile giriş yapın. Tüm kayıtlı kullanıcılar
(doğrulanmış/doğrulanmamış) e-posta, **şifre** ve **güncel doğrulama kodu** sütunlarıyla birlikte
listelenir — kullanıcı Discord'dan şifresini veya kodunu unuttuğunu söylediğinde tek bakışta
görüp iletebilirsiniz, ekstra bir tıklama gerekmez.

- "Ödül Ver" butonu kullanıcıyı işaretler, otomatik bir şey göndermez — ödülü elle vermeye devam
  edersiniz, sadece kime verdiğinizi takip edebilirsiniz.
- "Şifre Sıfırla" butonu, kullanıcı için rastgele yeni bir şifre üretir (eski şifre artık
  çalışmaz); yeni şifre de aynı şekilde tabloda doğrudan görünür.

## Kendi sunucunuzda yayınlama (özet)

1. Bu klasörü sunucunuza kopyalayın (Node.js 22+ kurulu olmalı — proje `node:sqlite` yerleşik
   modülünü kullanır, ekstra derleme aracı gerekmez).
2. `npm install --omit=dev`
3. `.env` dosyasını sunucuda gerçek değerlerle oluşturun; `NODE_ENV=production` yapın.
4. Uygulamayı sürekli ayakta tutmak için `pm2` gibi bir process manager kullanın:
   ```bash
   npm install -g pm2
   pm2 start server/index.js --name odul-sitesi
   pm2 save
   ```
5. Önüne bir ters proxy (Nginx/Caddy) koyup **HTTPS (Let's Encrypt) zorunlu** hale getirin.
   `NODE_ENV=production` iken oturum çerezi yalnızca HTTPS üzerinden çalışacak şekilde
   ayarlanmıştır (`secure: true`), bu yüzden HTTPS olmadan girişler çalışmaz.

## Güvenlik notları — lütfen okuyun

Kullanıcı isteği üzerine şifreler ve doğrulama kodları admin panelinde **düz metin olarak
görüntülenebilir** hale getirildi. Bunu mümkün kılmak için şifreler, girişte kullanılan güvenli
bcrypt hash'e **ek olarak** geri döndürülebilir şifreleme (AES-256-GCM, `ENCRYPTION_KEY` ile) ile
de saklanıyor; doğrulama kodları da aynı şekilde şifreli tutuluyor.

Bunun anlamı: standart bir sitede olduğu gibi "şifreler hiçbir şekilde geri alınamaz" garantisi
**burada geçerli değil**. Sunucunuz, `.env` dosyanız veya `server/veri.sqlite` veritabanı ele
geçirilirse, `ENCRYPTION_KEY` de ele geçirilmiş olduğundan tüm kullanıcı şifreleri açılabilir.
Kullanıcılar genelde aynı şifreyi başka sitelerde de kullandığı için bu, yalnızca bu site değil
kullanıcıların başka hesapları için de risk oluşturur. Bunu bilerek ilerlediyseniz aşağıdakilere
özellikle dikkat edin:

- `ENCRYPTION_KEY` ve `ADMIN_SIFRE` değerlerini güçlü tutun ve asla paylaşmayın.
- `/admin` paneline yalnızca güvendiğiniz kişiler erişebilsin (URL'yi paylaşmayın, mümkünse
  sunucu seviyesinde ek bir erişim kısıtlaması — ör. IP allowlist — düşünün).
- **HTTPS zorunlu** — aksi halde şifreler ağ üzerinden düz metin olarak da akar.
- `.env` ve `server/veri.sqlite` dosyalarını asla paylaşmayın veya git'e eklemeyin (`.gitignore`
  içinde zaten hariç tutuldu); sunucu yedeklerinizi de aynı hassasiyetle koruyun.
- Kayıt/giriş/doğrulama uçlarında istek sınırlama (rate limiting) aktiftir; doğrulama kodları
  10 dakika sonra geçersiz olur, 5 yanlış denemeden sonra kilitlenir.
