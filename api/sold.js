const crypto = require('crypto');

// ── Tokenlar Vercel Environment Variables dan o'qiladi ──────────────────────
const PIXEL_ID       = process.env.META_PIXEL_ID;
const ACCESS_TOKEN   = process.env.META_ACCESS_TOKEN;
const AMO_TOKEN      = process.env.AMO_TOKEN;
const AMO_SUBDOMAIN  = process.env.AMO_SUBDOMAIN;
const SOLD_STATUS_ID = parseInt(process.env.AMO_SOLD_STATUS_ID || '0');
const FIELD_FBP = parseInt(process.env.AMO_FIELD_FBP || '0');
const FIELD_FBC = parseInt(process.env.AMO_FIELD_FBC || '0');

// ── Yordamchi funksiyalar ────────────────────────────────────────────────────
function sha256(val) {
  return crypto.createHash('sha256').update((val || '').trim().toLowerCase()).digest('hex');
}

function cleanPhone(phone) {
  const c = (phone || '').replace(/\D/g, '');
  if (c.startsWith('998')) return '+' + c;
  if (c.length === 9)      return '+998' + c;
  return '+' + c;
}

// ── Asosiy handler ───────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const body = req.body;
    console.log('[SOLD WEBHOOK] Keldi:', JSON.stringify(body));

    let i = 0;
    while (body[`leads[status][${i}][id]`] !== undefined) {
      const leadId   = body[`leads[status][${i}][id]`];
      const statusId = parseInt(body[`leads[status][${i}][status_id]`] || '0');

      console.log(`Lead ${leadId} → etap ${statusId}`);

      if (statusId === SOLD_STATUS_ID) {
        const leadInfo = await fetchLeadDetails(leadId);
        if (leadInfo) {
          await sendPurchaseToMeta(leadId, leadInfo);
        }
      }
      i++;
    }

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('[SOLD ERROR]', err);
    return res.status(200).json({ ok: true }); // Har doim 200 — AmoCRM qayta urinmasin
  }
};

// ── AmoCRM dan lid ma'lumotlarini olish ─────────────────────────────────────
async function fetchLeadDetails(leadId) {
  if (!AMO_SUBDOMAIN || !AMO_TOKEN) return null;

  const headers = { 'Authorization': `Bearer ${AMO_TOKEN}` };

  try {
    // Lid + bog'liq kontakt
    const leadRes = await fetch(
      `https://${AMO_SUBDOMAIN}.amocrm.ru/api/v4/leads/${leadId}?with=contacts`,
      { headers }
    );
    if (!leadRes.ok) return null;
    const lead = await leadRes.json();

    const contactId = lead?._embedded?.contacts?.[0]?.id;
    if (!contactId) return null;

    // Kontakt ma'lumotlari
    const contactRes = await fetch(
      `https://${AMO_SUBDOMAIN}.amocrm.ru/api/v4/contacts/${contactId}`,
      { headers }
    );
    if (!contactRes.ok) return null;
    const contact = await contactRes.json();

    let phone     = '';
    let fbp       = '';
    let fbc       = '';
    const firstName = (contact.name || '').split(' ')[0].toLowerCase();

    for (const field of contact.custom_fields_values || []) {
      if (field.field_code === 'PHONE' && field.values?.[0]?.value) {
        phone = cleanPhone(field.values[0].value);
      }
      if (field.field_id === FIELD_FBP && field.values?.[0]?.value) {
        fbp = field.values[0].value;
      }
      if (field.field_id === FIELD_FBC && field.values?.[0]?.value) {
        fbc = field.values[0].value;
      }
    }

    return { phone, firstName, fbp, fbc, price: lead.price || 0 };

  } catch (err) {
    console.error('[SOLD] Lead olishda xatolik:', err);
    return null;
  }
}

// ── Meta CAPI — Purchase event ───────────────────────────────────────────────
async function sendPurchaseToMeta(leadId, data) {
  if (!PIXEL_ID || !ACCESS_TOKEN) {
    console.warn('[META PURCHASE] Credentials yo\'q');
    return { skipped: true };
  }

  const userData = { client_user_agent: 'amoCRM' };
  if (data.phone)     userData.ph  = [sha256(data.phone)];
  if (data.firstName) userData.fn  = [sha256(data.firstName)];
  if (data.fbp)       userData.fbp = data.fbp;
  if (data.fbc)       userData.fbc = data.fbc;

  const payload = {
    data: [{
      event_name:       'Purchase',
      event_time:       Math.floor(Date.now() / 1000),
      event_id:         `sold_${leadId}_${Date.now()}`,
      event_source_url: process.env.SITE_URL || '',
      action_source:    'crm',
      user_data:        userData,
      custom_data: {
        value:    data.price,
        currency: 'UZS',
      },
    }],
  };

  const res    = await fetch(
    `https://graph.facebook.com/v19.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
  );
  const result = await res.json();
  if (!res.ok) console.error('[META PURCHASE ERROR]', result);
  else         console.log('[META PURCHASE] Purchase yuborildi, summa:', data.price);
  return result;
}
