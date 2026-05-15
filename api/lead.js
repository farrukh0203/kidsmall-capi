const crypto = require('crypto');

const PIXEL_ID      = '1504265268073912';
const ACCESS_TOKEN  = 'EAAQRGvuUf0IBRUytzzms9B8RZAuvwC0dBNgAvMyZA7qOBEKZBPT3LleGXGVoOjnpqgk7TafiamPpGuJlfvw8X0A8784ZAYVpP1psOaR0wqlWWVglOXZA0WBYCz2K2cQMZAX2SRh5BcqZA8kZC9sycwavPVGe2JvOc5W674VM853l3kMVUN4dvRXZC5i3qxr3VKLfGIAZDZD';
const AMO_TOKEN     = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImp0aSI6IjEzNzVlMDYwZDNjZmU1MzU5MGJmMWJhZjZhNWQwZjZjOGE2YzljMzA2YWY0M2FlMjFlYzNhZDZhYTI5YzZmNWViNWM0MTkxN2M0YTFmN2NjIn0.eyJhdWQiOiI0MTQ4NDdhYS0zZGRlLTRhZjEtOTMyYi1lOTEzMjA0NDhhMzUiLCJqdGkiOiIxMzc1ZTA2MGQzY2ZlNTM1OTBiZjFiYWY2YTVkMGY2YzhhNmM5YzMwNmFmNDNhZTIxZWMzYWQ2YWEyOWM2ZjVlYjVjNDE5MTdjNGExZjdjYyIsImlhdCI6MTc3ODgyNDM2NSwibmJmIjoxNzc4ODI0MzY1LCJleHAiOjE5MzY1Njk2MDAsInN1YiI6IjExNTgxMDQ2IiwiZ3JhbnRfdHlwZSI6IiIsImFjY291bnRfaWQiOjMxOTc4ODM4LCJiYXNlX2RvbWFpbiI6ImFtb2NybS5ydSIsInZlcnNpb24iOjIsInNjb3BlcyI6WyJwdXNoX25vdGlmaWNhdGlvbnMiLCJmaWxlcyIsImNybSIsImZpbGVzX2RlbGV0ZSIsIm5vdGlmaWNhdGlvbnMiXSwiaGFzaF91dWlkIjoiY2Y3ZjQzMDMtY2Y3Yi00MGE0LWE2Y2YtNWE4NjllZmY3ZDRlIiwiYXBpX2RvbWFpbiI6ImFwaS1iLmFtb2NybS5ydSJ9.OAVuV7hW84PbfzP9cthBFy6neiI0QAlKWawYCcwzYwL1YREfgwgj6drx--oYhX52O19wb2h8FL8s4hPJohoGhPdlDOGlIm1TUdrKMY1eGS-HT1gS-5K63yGuG4oisVFdOFeXW_G-sp95rzNZgJy2ZzeWyn57xrh7QIr6ifsQYexXgPAIcjztgRE0AHmAcvhAoWVZpLLE8Z6_2mmmfiFeNZ4icXWLQnH9tk38rUpWyqfQhBHC_o_8GB-MLRkMO3AfGV35X331gaUX2NxoSxZ4JlIWZ9fmHOYyxBhhCi0Za4Ee7z1U7afh5_CDXm6tinI4ScOmu3Jj01zd23OjSPAwEw';
const AMO_SUBDOMAIN = 'kidsmall';
const AMO_PIPELINE  = 10613274;
const AMO_STAGE     = 83679402;
const FIELD_AGE     = 850509;

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
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { name, phone, age, eventId, userAgent, sourceUrl } = req.body;
    if (!phone || !name) return res.status(400).json({ error: 'name va phone majburiy' });

    const cleanedPhone = cleanPhone(phone);
    const firstName = (name||'').trim().split(' ')[0].toLowerCase();

    // 1. Meta CAPI — Lead
    const capiPayload = {
      test_event_code: 'TEST75343',
      data: [{
        event_name: 'Lead',
        event_time: Math.floor(Date.now() / 1000),
        action_source: 'website',
        event_source_url: sourceUrl || 'https://kidsmall-capi.vercel.app',
        event_id: eventId || ('lead_' + Date.now()),
        user_data: {
          ph: sha256(cleanedPhone),
          fn: sha256(firstName),
          client_user_agent: userAgent || 'unknown',
        },
      }],
    };

    const capiRes = await fetch(
      'https://graph.facebook.com/v19.0/' + PIXEL_ID + '/events?access_token=' + ACCESS_TOKEN,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(capiPayload) }
    );
    const capiData = await capiRes.json();
    console.log('CAPI Lead:', JSON.stringify(capiData));

    // 2. amoCRM lead
    const amoPayload = [{
      name: name + " — Ko'ylakcha",
      pipeline_id: AMO_PIPELINE,
      status_id: AMO_STAGE,
      tags: [{ name: 'CAPI' }],
      _embedded: {
        contacts: [{
          name: name,
          custom_fields_values: [
            { field_code: 'PHONE', values: [{ value: cleanedPhone, enum_code: 'WORK' }] }
          ]
        }]
      }
    }];

    const amoRes = await fetch(
      'https://' + AMO_SUBDOMAIN + '.amocrm.ru/api/v4/leads/complex',
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + AMO_TOKEN }, body: JSON.stringify(amoPayload) }
    );
    const amoData = await amoRes.json();
    console.log('amoCRM lead:', JSON.stringify(amoData));

    // 3. Tag + Yosh
    if (amoData && amoData[0] && amoData[0].id) {
      const leadId = amoData[0].id;

      await fetch('https://' + AMO_SUBDOMAIN + '.amocrm.ru/api/v4/leads', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + AMO_TOKEN },
        body: JSON.stringify([{ id: leadId, _embedded: { tags: [{ name: 'CAPI' }] } }])
      });

      if (age) {
        await fetch('https://' + AMO_SUBDOMAIN + '.amocrm.ru/api/v4/leads', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + AMO_TOKEN },
          body: JSON.stringify([{ id: leadId, custom_fields_values: [{ field_id: FIELD_AGE, values: [{ value: age }] }] }])
        });
      }
    }

    return res.status(200).json({ success: true, capi: capiData, amo: amoData });

  } catch (err) {
    console.error('Xato:', err);
    return res.status(500).json({ error: err.message });
  }
};
