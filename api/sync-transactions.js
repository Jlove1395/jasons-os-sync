// api/sync-transactions.js
// Vercel serverless function — pulls the last 30 days of transactions
// from all connected Plaid items and writes them to Supabase.
// Call this on a cron schedule (Vercel Cron) or manually from the dashboard.

const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');
const { createClient } = require('@supabase/supabase-js');

const plaid = new PlaidApi(
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
  process.env.SUPABASE_SERVICE_KEY
);

// Map Plaid's category to your dashboard categories
function mapCategory(plaidCategories) {
  if (!plaidCategories || !plaidCategories.length) return 'Other';
  const primary = (plaidCategories[0] || '').toLowerCase();
  const detail = (plaidCategories[1] || '').toLowerCase();

  if (primary.includes('food') || detail.includes('restaurant') || detail.includes('fast food')) return 'Food & Dining';
  if (primary.includes('travel') || detail.includes('airlines') || detail.includes('hotel')) return 'Travel';
  if (detail.includes('gas') || detail.includes('fuel') || primary.includes('gas')) return 'Gas';
  if (primary.includes('shops') || primary.includes('shopping')) return 'Shopping';
  if (primary.includes('recreation') || primary.includes('entertainment')) return 'Entertainment';
  if (primary.includes('service') && detail.includes('subscription')) return 'Subscriptions';
  if (primary.includes('healthcare') || primary.includes('medical')) return 'Health';
  if (detail.includes('home') || detail.includes('hardware')) return 'Home';
  return 'Other';
}

// Map Plaid account name to your card IDs
function mapCard(accountName, accountId, knownAccounts) {
  const name = (accountName || '').toLowerCase();
  // Match by position — first Chase card = card1, second = card2
  const idx = knownAccounts.findIndex(a => a.account_id === accountId);
  if (idx === 0) return 'card1';
  if (idx === 1) return 'card2';
  return 'card1'; // fallback
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-sync-secret');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Basic auth check for cron calls
  const secret = req.headers['x-sync-secret'];
  if (secret !== process.env.SYNC_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Get all stored Plaid access tokens
    const { data: items, error: itemsErr } = await supabase
      .from('plaid_items')
      .select('*');

    if (itemsErr) throw new Error(itemsErr.message);
    if (!items || !items.length) return res.status(200).json({ message: 'No connected accounts yet' });

    const today = new Date();
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(today.getDate() - 30);
    const startDate = thirtyDaysAgo.toISOString().split('T')[0];
    const endDate = today.toISOString().split('T')[0];

    let totalInserted = 0;

    for (const item of items) {
      const accounts = JSON.parse(item.accounts || '[]');

      // Fetch transactions from Plaid
      const txnRes = await plaid.transactionsGet({
        access_token: item.access_token,
        start_date: startDate,
        end_date: endDate,
        options: { count: 250, offset: 0 },
      });

      const plaidTxns = txnRes.data.transactions;

      // Filter to credit card transactions only (exclude transfers, payments)
      const filtered = plaidTxns.filter(t =>
        !t.pending &&
        t.amount > 0 && // positive = money spent
        !(t.category || []).join(' ').toLowerCase().includes('payment') &&
        !(t.category || []).join(' ').toLowerCase().includes('transfer')
      );

      // Build rows for Supabase
      const rows = filtered.map(t => ({
        merchant: t.merchant_name || t.name,
        amount: Math.abs(t.amount),
        category: mapCategory(t.category),
        card: mapCard(t.account_id, t.account_id, accounts),
        date: t.date,
        auto: true,
        plaid_transaction_id: t.transaction_id,
      }));

      if (rows.length) {
        // Upsert — won't create duplicates on repeated syncs
        const { error: upsertErr } = await supabase
          .from('transactions')
          .upsert(rows, { onConflict: 'plaid_transaction_id', ignoreDuplicates: true });

        if (upsertErr) console.error('Upsert error:', upsertErr.message);
        else totalInserted += rows.length;
      }
    }

    res.status(200).json({ success: true, synced: totalInserted, range: `${startDate} → ${endDate}` });
  } catch (err) {
    console.error('sync-transactions error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Sync failed', detail: err.message });
  }
};
