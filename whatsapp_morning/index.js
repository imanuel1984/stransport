/**
 * WhatsApp Daily - שולח כל יום הודעה אישית לאמא ולאבא
 * אמא: "בוקר טוב אמי היקרה :)"
 * אבא: "בוקר טוב אבי היקר :)"
 * לא שולח בשבת ולא ביום טוב (חגים).
 *
 * הרצה ראשונה: סריקת QR code עם וואטסאפ בטלפון.
 * אחר כך הסשן נשמר ולא צריך לסרוק שוב.
 */

const { Client, LocalAuth } = require('whatsapp-web.js');
const cron = require('node-cron');
const qrcode = require('qrcode-terminal');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const MESSAGE_MOM = process.env.MESSAGE_MOM || 'בוקר טוב אמי היקרה :)';
const MESSAGE_DAD = process.env.MESSAGE_DAD || 'בוקר טוב אבי היקר :)';
const CRON_TIME = process.env.CRON_TIME || '0 7 * * *';

const MOM_NUMBER = process.env.PARENTS_WHATSAPP_NUMBER_MOM;
const DAD_NUMBER = process.env.PARENTS_WHATSAPP_NUMBER_DAD;

if (!MOM_NUMBER || !DAD_NUMBER) {
  console.error('❌ חסרים PARENTS_WHATSAPP_NUMBER_MOM ו/או PARENTS_WHATSAPP_NUMBER_DAD ב-.env');
  process.exit(1);
}

function toChatId(number) {
  const digits = number.replace(/\D/g, '');
  return `${digits}@c.us`;
}

/** מחזיר true אם היום שבת (לא שולחים) */
function isShabbat() {
  const day = new Date().getDay(); // 0=Sunday, 6=Saturday
  return day === 6;
}

/** בודק ב-Hebcal אם היום יום טוב (חג) – לא שולחים */
async function isYomTov() {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  const dateStr = `${y}-${m}-${d}`;
  try {
    const url = `https://www.hebcal.com/hebcal?v=1&cfg=json&maj=on&min=on&mod=on&nx=on&start=${dateStr}&end=${dateStr}`;
    const res = await fetch(url);
    const data = await res.json();
    const hasHoliday = (data.items || []).some((item) => item.category === 'holiday');
    return hasHoliday;
  } catch (err) {
    console.warn('⚠️ לא הצלחתי לבדוק יום טוב (Hebcal):', err.message);
    return false;
  }
}

/** true = לא לשלוח (שבת או יום טוב) */
async function isShabbatOrYomTov() {
  if (isShabbat()) return true;
  return await isYomTov();
}

const client = new Client({
  authStrategy: new LocalAuth({
    clientId: 'morning_parents',
    dataPath: path.join(__dirname, '.wwebjs_auth'),
  }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  },
});

async function sendMorningMessage() {
  if (await isShabbatOrYomTov()) {
    console.log('🕯️ היום שבת או יום טוב – לא שולחים הודעות.');
    return;
  }
  const toSend = [
    { number: MOM_NUMBER, message: MESSAGE_MOM, label: 'אמא' },
    { number: DAD_NUMBER, message: MESSAGE_DAD, label: 'אבא' },
  ];
  for (const { number, message, label } of toSend) {
    try {
      const chatId = toChatId(number);
      await client.sendMessage(chatId, message);
      console.log(`✅ נשלח ל${label}: "${message}"`);
    } catch (err) {
      console.error(`❌ שליחה ל${label} (${number}) נכשלה:`, err.message);
    }
  }
}

client.on('qr', (qr) => {
  console.log('\n📱 הקוד מופיע כאן למטה (בטרמינל).');
  console.log('   בטלפון: וואטסאפ → הגדרות → מכשירים מקושרים → חבר מכשיר → סרוק את הריבוע הזה:\n');
  qrcode.generate(qr, { small: true });
});

client.on('ready', async () => {
  console.log('✅ מחובר ל-WhatsApp');

  const sendNow = process.argv.includes('--send-now');
  if (sendNow) {
    await sendMorningMessage();
    console.log('סיום (מצב send-now).');
    process.exit(0);
    return;
  }

  cron.schedule(CRON_TIME, async () => {
    await sendMorningMessage();
  });

  console.log(`⏰ שליחה אוטומטית מוגדרת ל: ${CRON_TIME} (כל יום בשעה 7:00, מלבד שבת ויום טוב)`);
  console.log('הסקריפט רץ. השאר אותו פתוח.');
});

client.on('auth_failure', (msg) => {
  console.error('❌ כשל אימות:', msg);
});

client.on('disconnected', (reason) => {
  console.log('🔌 התנתקות:', reason);
});

client.initialize();
