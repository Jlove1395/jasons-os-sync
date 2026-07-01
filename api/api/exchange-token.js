// api/exchange-token.js
// Vercel serverless function — exchanges the Plaid public token for a
// permanent access token, then stores it in Supabase for daily syncing.

const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');
const { createClient } = require('@supabase/supabase-js');

const client = new PlaidApi(
  new Configuration({
    basePath: PlaidEnvironments[process.env.PLAID_ENV || 'sandbox'],
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
        'PLAID-SECRET': process.env.PLAID_SECRET,
      },
    },
  })
);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY  // use service key here (server-side only)
);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { public_token, accounts } = req.body;
  if (!public_token) return res.status(400).json({ error: 'Missing public_token' });

  try {
    // Exchange public token for permanent access token
    const exchangeRes = await client.itemPublicTokenExchange({ public_token });
    const accessToken = exchangeRes.data.access_token;
    const itemId = exchangeRes.data.item_id;

    // Store access token securely in Supabase
    const { error } = await supabase
      .from('plaid_items')
      .upsert({ item_id: itemId, access_token: accessToken, accounts: JSON.stringify(accounts || []) });

    if (error) throw new Error(error.message);

    res.status(200).json({ success: true, item_id: itemId });
  } catch (err) {
    console.error('exchange-token error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to exchange token', detail: err.message });
  }
};
