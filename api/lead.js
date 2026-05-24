const crypto = require('crypto');

const PIXEL_ID      = process.env.META_PIXEL_ID;
const ACCESS_TOKEN  = process.env.META_ACCESS_TOKEN;
const AMO_TOKEN     = process.env.AMO_TOKEN;
const AMO_SUBDOMAIN = process.env.AMO_SUBDOMAIN;
const AMO_PIPELINE  = parseInt(process.env.AMO_PIPELINE_ID || '0');
const AMO_STAGE     = parseInt(process.env.AMO_STAGE_ID    || '0');
const FIELD_FBP     = parseInt(process.env.AMO_FIELD_FBP   || '0');
const FIELD_FBC     = parseInt(process.env.AMO_FIELD_FBC   || '0');

function sha256(val) {
  return crypto.createHash('sha256').update((val || '').trim().toLowerCase()).digest('hex');
}

function cleanPhone(phone) {
  const c = (phone || '').replace(/\D/g, '');
  if (c.startsWith('998')) return '+' + c;
  if (c.length === 9)      return '+998' + c;
  return '+' + c;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { name, phone, product, eventId, fbp, fbc, userAgent, sourceUrl } = req.body;

    if (!name || !phone) {
      return res.status(400).json({ error: 'name va phone majburiy' });
    }

    const cleanedPhone = cleanPhone(phone);
    const firstName    = (name || '').trim().split(' ')[0].toLowerCase();

    // IPv6 ni birinchi tanlaymiz, bo'lmasa IPv4
    const forwarded = (req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
    const clientIp  = forwarded.find(ip => ip.includes(':')) || forwarded[0] || req.headers['x-real-ip'] || '';

    // 1. Meta CAPI — Lead event
    await sendMetaCAPI({
      eventId:   eventId || ('lead_' + Date.now()),
      phone:     cleanedPhone,
      firstName,
      fbp:       fbp || '',
      fbc:       fbc || '',
      userAgent: userAgent || '',
      sourceUrl: sourceUrl || '',
      product:   product || '',
      clientIp,
    });

    // 2. AmoCRM
    await createAmoCRMLead({ name, phone: cleanedPhone, product, fbp, fbc, sourceUrl });

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('[LEAD ERROR]', err);
    return res.status(500).json({ error: err.message });
  }
};

async function sendMetaCAPI(data) {
  if (!PIXEL_ID || !ACCESS_TOKEN) {
    console.warn('[META CAPI] Credentials yo\'q');
    return;
  }

  const payload = {
    data: [{
      event_name:       'Lead',
      event_time:       Math.floor(Date.now() / 1000),
      event_id:         data.eventId,
      event_source_url: data.sourceUrl,
      action_source:    'website',
      user_data: {
        ph:                sha256(data.phone),
        fn:                sha256(data.firstName),
        client_ip_address: data.clientIp,
        client_user_agent: data.userAgent,
        fbp:               data.fbp,
        fbc:               data.fbc,
      },
      custom_data: {
        content_name: data.product,
      },
    }],
  };

  const res    = await fetch(
    `https://graph.facebook.com/v19.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
  );
  const result = await res.json();
  if (!res.ok) console.error('[META CAPI ERROR]', result);
  else         console.log('[META CAPI] Lead yuborildi:', data.product);
  return result;
}

async function createAmoCRMLead(data) {
  if (!AMO_SUBDOMAIN || !AMO_TOKEN) {
    console.warn('[AMOCRM] Credentials yo\'q');
    return;
  }

  const base    = `https://${AMO_SUBDOMAIN}.amocrm.ru`;
  const headers = {
    'Content-Type':  'application/json',
    'Authorization': `Bearer ${AMO_TOKEN}`,
  };

  // 1. Kontakt qidirish
  let contactId = null;
  try {
    const searchText = await (await fetch(
      `${base}/api/v4/contacts?query=${encodeURIComponent(data.phone)}`,
      { headers }
    )).text();

    if (searchText) {
      const searchData = JSON.parse(searchText);
      const existing   = searchData?._embedded?.contacts?.[0];
      if (existing) {
        contactId = existing.id;
        console.log('[AMOCRM] Mavjud kontakt:', contactId);

        // FBP/FBC yangilash
        if (data.fbp || data.fbc) {
          const fields = [];
          if (data.fbp && FIELD_FBP) fields.push({ field_id: FIELD_FBP, values: [{ value: data.fbp }] });
          if (data.fbc && FIELD_FBC) fields.push({ field_id: FIELD_FBC, values: [{ value: data.fbc }] });
          if (fields.length) {
            await fetch(`${base}/api/v4/contacts`, {
              method: 'PATCH', headers,
              body: JSON.stringify([{ id: contactId, custom_fields_values: fields }]),
            });
          }
        }
      }
    }
  } catch (err) {
    console.warn('[AMOCRM] Qidirishda xatolik:', err.message);
  }

  // 2. Yangi kontakt yaratish
  if (!contactId) {
    const customFields = [
      { field_code: 'PHONE', values: [{ value: data.phone, enum_code: 'WORK' }] },
    ];
    if (data.fbp && FIELD_FBP) customFields.push({ field_id: FIELD_FBP, values: [{ value: data.fbp }] });
    if (data.fbc && FIELD_FBC) customFields.push({ field_id: FIELD_FBC, values: [{ value: data.fbc }] });

    const cRes  = await fetch(`${base}/api/v4/contacts`, {
      method: 'POST', headers,
      body: JSON.stringify([{ name: data.name, custom_fields_values: customFields }]),
    });
    const cData = await cRes.json();
    contactId   = cData?._embedded?.contacts?.[0]?.id;
    console.log('[AMOCRM] Yangi kontakt:', contactId);
  }

  // 3. Lid yaratish — mahsulot bo'yicha tag
  const tag = data.product ? `CAPI ${data.product}` : 'CAPI';
  const leadRes  = await fetch(`${base}/api/v4/leads`, {
    method: 'POST', headers,
    body: JSON.stringify([{
      name:        `${data.name} — ${data.product || 'Kiyim'}`,
      pipeline_id: AMO_PIPELINE,
      status_id:   AMO_STAGE,
      _embedded: {
        contacts: contactId ? [{ id: contactId }] : [],
        tags: [{ name: tag }],
      },
    }]),
  });
  const leadData = await leadRes.json();
  const leadId   = leadData?._embedded?.leads?.[0]?.id;
  console.log('[AMOCRM] Lid yaratildi:', leadId, '| Mahsulot:', tag);

  // 4. Izoh
  if (leadId) {
    try {
      await fetch(`${base}/api/v4/leads/${leadId}/notes`, {
        method: 'POST', headers,
        body: JSON.stringify([{
          note_type: 'common',
          params: {
            text: `Telefon: ${data.phone}\nMahsulot: ${data.product || '—'}\nManba: ${data.sourceUrl || '—'}\nFBP: ${data.fbp || '—'}\nFBC: ${data.fbc || '—'}`,
          },
        }]),
      });
      console.log('[AMOCRM] Izoh qo\'shildi');
    } catch (err) {
      console.warn('[AMOCRM] Izoh xatolik:', err.message);
    }
  }

  return { leadId, contactId };
}
