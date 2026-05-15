const crypto = require('crypto');

const PIXEL_ID      = '1504265268073912';
const ACCESS_TOKEN  = 'EAAQRGvuUf0IBRUytzzms9B8RZAuvwC0dBNgAvMyZA7qOBEKZBPT3LleGXGVoOjnpqgk7TafiamPpGuJlfvw8X0A8784ZAYVpP1psOaR0wqlWWVglOXZA0WBYCz2K2cQMZAX2SRh5BcqZA8kZC9sycwavPVGe2JvOc5W674VM853l3kMVUN4dvRXZC5i3qxr3VKLfGIAZDZD';
const AMO_TOKEN     = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImp0aSI6IjEzNzVlMDYwZDNjZmU1MzU5MGJmMWJhZjZhNWQwZjZjOGE2YzljMzA2YWY0M2FlMjFlYzNhZDZhYTI5YzZmNWViNWM0MTkxN2M0YTFmN2NjIn0.eyJhdWQiOiI0MTQ4NDdhYS0zZGRlLTRhZjEtOTMyYi1lOTEzMjA0NDhhMzUiLCJqdGkiOiIxMzc1ZTA2MGQzY2ZlNTM1OTBiZjFiYWY2YTVkMGY2YzhhNmM5YzMwNmFmNDNhZTIxZWMzYWQ2YWEyOWM2ZjVlYjVjNDE5MTdjNGExZjdjYyIsImlhdCI6MTc3ODgyNDM2NSwibmJmIjoxNzc4ODI0MzY1LCJleHAiOjE5MzY1Njk2MDAsInN1YiI6IjExNTgxMDQ2IiwiZ3JhbnRfdHlwZSI6IiIsImFjY291bnRfaWQiOjMxOTc4ODM4LCJiYXNlX2RvbWFpbiI6ImFtb2NybS5ydSIsInZlcnNpb24iOjIsInNjb3BlcyI6WyJwdXNoX25vdGlmaWNhdGlvbnMiLCJmaWxlcyIsImNybSIsImZpbGVzX2RlbGV0ZSIsIm5vdGlmaWNhdGlvbnMiXSwiaGFzaF91dWlkIjoiY2Y3ZjQzMDMtY2Y3Yi00MGE0LWE2Y2YtNWE4NjllZmY3ZDRlIiwiYXBpX2RvbWFpbiI6ImFwaS1iLmFtb2NybS5ydSJ9.OAVuV7hW84PbfzP9cthBFy6neiI0QAlKWawYCcwzYwL1YREfgwgj6drx--oYhX52O19wb2h8FL8s4hPJohoGhPdlDOGlIm1TUdrKMY1eGS-HT1gS-5K63yGuG4oisVFdOFeXW_G-sp95rzNZgJy2ZzeWyn57xrh7QIr6ifsQYexXgPAIcjztgRE0AHmAcvhAoWVZpLLE8Z6_2mmmfiFeNZ4icXWLQnH9tk38rUpWyqfQhBHC_o_8GB-MLRkMO3AfGV35X331gaUX2NxoSxZ4JlIWZ9fmHOYyxBhhCi0Za4Ee7z1U7afh5_CDXm6tinI4ScOmu3Jj01zd23OjSPAwEw';
const AMO_SUBDOMAIN   = 'kidsmall';
const SOLD_STATUS_ID  = 142;

function sha256(val) {
  return crypto.createHash('sha256').update((val||'').trim().toLowerCase()).digest('hex');
}
function cleanPhone(phone) {
  let c = (phone||'').replace(/\D/g,'');
  if (c.startsWith('998')) return '+' + c;
  if (c.length === 9) return '+998' + c;
  return '+' + c;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const body = req.body;
    console.log('Webhook keldi:', JSON.stringify(body));

    let i = 0;
    while (body[`leads[status][${i}][id]`] !== undefined) {
      const leadId   = body[`leads[status][${i}][id]`];
      const statusId = parseInt(body[`leads[status][${i}][status_id]`]);

      console.log(`Lead ${leadId} → etap ${statusId}`);

      if (statusId === SOLD_STATUS_ID) {
        // amoCRM dan contact ma'lumotlarini olish
        const leadRes = await fetch(
          `https://${AMO_SUBDOMAIN}.amocrm.ru/api/v4/leads/${leadId}?with=contacts`,
          { headers: { 'Authorization': 'Bearer ' + AMO_TOKEN } }
        );
        const leadData = await leadRes.json();

        let phone = '';
        let firstName = '';
        const contacts = leadData?._embedded?.contacts || [];
        if (contacts.length > 0) {
          const contactRes = await fetch(
            `https://${AMO_SUBDOMAIN}.amocrm.ru/api/v4/contacts/${contacts[0].id}`,
            { headers: { 'Authorization': 'Bearer ' + AMO_TOKEN } }
          );
          const contactData = await contactRes.json();
          firstName = (contactData.name || '').split(' ')[0].toLowerCase();
          for (const f of (contactData?.custom_fields_values || [])) {
            if (f.field_code === 'PHONE' && f.values?.[0]?.value) {
              phone = cleanPhone(f.values[0].value); break;
            }
          }
        }

        console.log(`Contact: ${firstName}, ${phone}`);

        // Meta CAPI — Purchase
        const userData = { client_user_agent: 'amoCRM' };
        if (phone)     userData.ph = sha256(phone);
        if (firstName) userData.fn = sha256(firstName);

        const capiRes = await fetch(
          `https://graph.facebook.com/v19.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              data: [{
                event_name: 'Purchase',
                event_time: Math.floor(Date.now() / 1000),
                action_source: 'crm',
                event_source_url: 'https://kidsmall-capi.vercel.app',
                event_id: `sold_${leadId}_${Date.now()}`,
                user_data: userData,
                custom_data: { value: leadData?.price || 0, currency: 'UZS' }
              }]
            })
          }
        );
        const capiData = await capiRes.json();
        console.log(`Lead ${leadId} — Purchase yuborildi:`, JSON.stringify(capiData));
      }
      i++;
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('sold.js xato:', err);
    return res.status(500).json({ error: err.message });
  }
};
