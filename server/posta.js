const nodemailer = require('nodemailer');

const smtpAyarli = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

const tasiyici = smtpAyarli
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
  : null;

/**
 * Dogrulama kodunu e-posta ile gonderir. SMTP ayarlanmamissa (yerel test icin)
 * kodu sadece sunucu logunda gosterir ve gonderilmemis sayar.
 */
async function dogrulamaKoduGonder(email, kod) {
  if (!tasiyici) {
    console.log(`[POSTA - SMTP AYARLANMAMIS] ${email} icin dogrulama kodu: ${kod}`);
    return { gonderildi: false };
  }

  await tasiyici.sendMail({
    from: process.env.SMTP_FROM || 'Odul Kampanyasi <odul@example.com>',
    to: email,
    subject: 'Dogrulama Kodunuz',
    text: `Dogrulama kodunuz: ${kod}\n\nBu kod 10 dakika icinde gecerliligini yitirecektir.`,
    html: `<p>Dogrulama kodunuz: <b style="font-size:20px">${kod}</b></p><p>Bu kod 10 dakika icinde gecerliligini yitirecektir.</p>`,
  });
  return { gonderildi: true };
}

module.exports = { dogrulamaKoduGonder, smtpAyarli };
