// api/create-link-token.js
// Vercel serverless function — creates a Plaid Link token so the dashboard
// can launch the Plaid connection UI.

const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');

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

module.exports = async (req, res) => {
  // Allow requests from your dashboard
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const response = await client.linkTokenCreate({
      user: { client_user_id: 'jason-lovett' },
      client_name: "Jason's OS",
      products: ['transactions'],
      country_codes: ['US'],
      language: 'en',
    });

    res.status(200).json({ link_token: response.data.link_token });
  } catch (err) {
    console.error('create-link-token error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to create link token', detail: err.message });
  }
};
