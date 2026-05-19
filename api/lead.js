const crypto = require('crypto');

// ── Tokenlar Vercel Environment Variables dan o'qiladi ──────────────────────
const PIXEL_ID      = process.env.META_PIXEL_ID;
const ACCESS_TOKEN  = process.env.META_ACCESS_TOKEN;
const AMO_TOKEN     = process.env.AMO_TOKEN;
const AMO_SUBDOMAIN = process.env.AMO_SUBDOMAIN;
const AMO_PIPELINE  = parseInt(process.env.AMO_PIPELINE_ID  || '0');
const AMO_STAGE     = parseInt(process.env.AMO_STAGE_ID     || '0');
const FIELD_AGE     = parseInt(process.env.AMO_FIELD_AGE    || '0');
const FIELD_FBP     = 859807;
const FIELD_FBC     = 859809;

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

function getCookieValue(cookieStr, name) {
  if (!cookieStr) return '';
  const match = cookieStr.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? match[2] : '';
}

// ── Asosiy handler ───────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { name, phone, age, eventId, fbp, fbc, userAgent, sourceUrl } = req.body;

    if (!phone || !name) {
      return res.status(400).json({ error: 'name va phone majburiy' });
    }

    const cleanedPhone = cleanPhone(phone);
    const firstName    = (name || '').trim().split(' ')[0].toLowerCase();

    // 1. Meta CAPI — Lead event
    const capiResult = await sendMetaCAPI({
      eventId:   eventId || ('lead_' + Date.now()),
      phone:     cleanedPhone,
      firstName,
      fbp:       fbp || '',
      fbc:       fbc || '',
      userAgent: userAgent || '',
      sourceUrl: sourceUrl || process.env.NEXT_PUBLIC_SITE_URL || '',
    });

    // 2. AmoCRM — kontakt + lid
    const amoResult = await createAmoCRMLead({
      name,
      phone: cleanedPhone,
      age,
      fbp:       fbp || '',
      fbc:       fbc || '',
      sourceUrl: sourceUrl || '',
    });

    return res.status(200).json({ success: true, capi: capiResult, amo: amoResult });

  } catch (err) {
    console.error('[LEAD ERROR]', err);
    return res.status(500).json({ error: err.message || 'Server xatoligi' });
  }
};

// ── Meta CAPI ────────────────────────────────────────────────────────────────
async function sendMetaCAPI(data) {
  if (!PIXEL_ID || !ACCESS_TOKEN) {
    console.warn('[META CAPI] Credentials yo\'q, o\'tkazib yuborildi');
    return { skipped: true };
  }

  const payload = {
    data: [{
      event_name:       'Lead',
      event_time:       Math.floor(Date.now() / 1000),
      event_id:         data.eventId,
      event_source_url: data.sourceUrl,
      action_source:    'website',
      user_data: {
        ph:                [sha256(data.phone)],
        fn:                [sha256(data.firstName)],
        client_user_agent: data.userAgent,
        fbp:               data.fbp,
        fbc:               data.fbc,
      },
    }],
  };

  const res    = await fetch(
    `https://graph.facebook.com/v19.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
  );
  const result = await res.json();
  if (!res.ok) console.error('[META CAPI ERROR]', result);
  else         console.log('[META CAPI] Lead event yuborildi');
  return result;
}

// ── AmoCRM ───────────────────────────────────────────────────────────────────
async function createAmoCRMLead(data) {
  if (!AMO_SUBDOMAIN || !AMO_TOKEN) {
    console.warn('[AMOCRM] Credentials yo\'q, o\'tkazib yuborildi');
    return { skipped: true };
  }

  const base    = `https://${AMO_SUBDOMAIN}.amocrm.ru`;
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${AMO_TOKEN}`,
  };

  // 1. Mavjud kontaktni qidirish — duplicate oldini olish
  let contactId = null;
  try {
    const searchRes  = await fetch(
      `${base}/api/v4/contacts?query=${encodeURIComponent(data.phone)}`,
      { headers }
    );
    if (searchRes.ok) {
      const searchData = await searchRes.json();
      const existing   = searchData?._embedded?.contacts?.[0];
      if (existing) {
        contactId = existing.id;
        console.log('[AMOCRM] Mavjud kontakt topildi:', contactId);

        // FBP / FBC ni yangilash
        if (data.fbp || data.fbc) {
          const updateFields = [];
          if (data.fbp) updateFields.push({ field_id: FIELD_FBP, values: [{ value: data.fbp }] });
          if (data.fbc) updateFields.push({ field_id: FIELD_FBC, values: [{ value: data.fbc }] });
          await fetch(`${base}/api/v4/contacts/${contactId}`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ custom_fields_values: updateFields }),
          });
          console.log('[AMOCRM] FBP/FBC yangilandi');
        }
      }
    }
  } catch (err) {
    console.warn('[AMOCRM] Qidirishda xatolik:', err);
  }

  // 2. Topilmasa — yangi kontakt yaratish
  if (!contactId) {
    const contactRes  = await fetch(`${base}/api/v4/contacts`, {
      method: 'POST',
      headers,
      body: JSON.stringify([{
        name: data.name,
        custom_fields_values: [
          { field_code: 'PHONE', values: [{ value: data.phone, enum_code: 'WORK' }] },
          ...(data.fbp ? [{ field_id: FIELD_FBP, values: [{ value: data.fbp }] }] : []),
          ...(data.fbc ? [{ field_id: FIELD_FBC, values: [{ value: data.fbc }] }] : []),
        ],
      }]),
    });
    const contactData = await contactRes.json();
    if (!contactRes.ok) {
      console.error('[AMOCRM] Kontakt yaratishda xatolik:', contactData);
    } else {
      contactId = contactData?._embedded?.contacts?.[0]?.id;
      console.log('[AMOCRM] Yangi kontakt yaratildi:', contactId);
    }
  }

  // 3. Lid yaratish
  const leadRes  = await fetch(`${base}/api/v4/leads`, {
    method: 'POST',
    headers,
    body: JSON.stringify([{
      name:        `${data.name} — Ko'ylakcha`,
      pipeline_id: AMO_PIPELINE,
      status_id:   AMO_STAGE,
      _embedded: {
        ...(contactId ? { contacts: [{ id: contactId }] } : {}),
        tags: [{ name: 'CAPI' }],
      },
    }]),
  });
  const leadData = await leadRes.json();
  if (!leadRes.ok) {
    console.error('[AMOCRM] Lid yaratishda xatolik:', leadData);
    throw new Error('AmoCRM lid yaratishda xatolik');
  }

  const leadId = leadData?._embedded?.leads?.[0]?.id;
  console.log('[AMOCRM] Lid yaratildi:', leadId);

  // 4. Yoshni saqlash
  if (leadId && data.age && FIELD_AGE) {
    await fetch(`${base}/api/v4/leads`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify([{
        id: leadId,
        custom_fields_values: [{ field_id: FIELD_AGE, values: [{ value: data.age }] }],
      }]),
    });
    console.log('[AMOCRM] Yosh saqlandi');
  }

  // 5. Izoh qo'shish
  if (leadId) {
    try {
      await fetch(`${base}/api/v4/leads/${leadId}/notes`, {
        method: 'POST',
        headers,
        body: JSON.stringify([{
          note_type: 'common',
          params: {
            text: `Telefon: ${data.phone}\nYosh: ${data.age || '—'}\nManba: ${data.sourceUrl || '—'}\nFBP: ${data.fbp || '—'}\nFBC: ${data.fbc || '—'}`,
          },
        }]),
      });
      console.log('[AMOCRM] Izoh qo\'shildi');
    } catch (err) {
      console.warn('[AMOCRM] Izoh qo\'shishda xatolik:', err);
    }
  }

  return { leadId, contactId };
}
