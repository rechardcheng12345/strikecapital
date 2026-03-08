// Quick API smoke test script
const BASE = 'http://localhost:3000/api';

async function api(method, path, body, token) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (token) opts.headers['Authorization'] = `Bearer ${token}`;
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  const data = await res.json();
  return { status: res.status, data };
}

async function run() {
  console.log('=== 1. Login as admin ===');
  const login = await api('POST', '/auth/login', {
    email: 'admin@strikecapital.com',
    password: 'admin123',
  });
  if (!login.data.token) {
    console.error('LOGIN FAILED:', login.data);
    process.exit(1);
  }
  const token = login.data.token;
  console.log('OK - user:', login.data.user.email, 'role:', login.data.user.role);

  console.log('\n=== 2. Dashboard Stats ===');
  const stats = await api('GET', '/admin/dashboard/stats', null, token);
  console.log('Status:', stats.status);
  console.log('Fields:', Object.keys(stats.data));
  const expected = ['total_positions', 'open_positions', 'total_premium', 'total_collateral', 'total_investors', 'total_realized_pnl', 'capital_utilization', 'positions_expiring_soon'];
  const missing = expected.filter(k => !(k in stats.data));
  if (missing.length) console.error('MISSING fields:', missing);
  else console.log('OK - all expected fields present');

  console.log('\n=== 3. Fund Settings ===');
  const settings = await api('GET', '/fund/settings', null, token);
  console.log('Status:', settings.status);
  console.log('Fields:', Object.keys(settings.data));
  console.log('fund_name:', settings.data.fund_name);

  console.log('\n=== 4. Create Position (AAPL $180 Put) ===');
  const pos1 = await api('POST', '/positions', {
    ticker: 'AAPL',
    strike_price: 180,
    premium_received: 320,
    contracts: 2,
    expiration_date: '2026-04-18',
    notes: 'Test trade - AAPL put',
  }, token);
  console.log('Status:', pos1.status);
  if (pos1.data.id) {
    console.log('OK - Position ID:', pos1.data.id, 'ticker:', pos1.data.ticker, 'collateral:', pos1.data.collateral, 'break_even:', pos1.data.break_even);
  } else {
    console.error('FAILED:', pos1.data);
  }

  console.log('\n=== 5. Create Position (TSLA $250 Put) ===');
  const pos2 = await api('POST', '/positions', {
    ticker: 'TSLA',
    strike_price: 250,
    premium_received: 890,
    contracts: 1,
    expiration_date: '2026-03-21',
    notes: 'Near expiry test trade',
  }, token);
  console.log('Status:', pos2.status);
  if (pos2.data.id) {
    console.log('OK - Position ID:', pos2.data.id, 'ticker:', pos2.data.ticker, 'collateral:', pos2.data.collateral);
  } else {
    console.error('FAILED:', pos2.data);
  }

  console.log('\n=== 6. Create Position (MSFT $400 Put) ===');
  const pos3 = await api('POST', '/positions', {
    ticker: 'MSFT',
    strike_price: 400,
    premium_received: 560,
    contracts: 1,
    expiration_date: '2026-05-16',
  }, token);
  console.log('Status:', pos3.status);
  if (pos3.data.id) {
    console.log('OK - Position ID:', pos3.data.id);
  } else {
    console.error('FAILED:', pos3.data);
  }

  console.log('\n=== 7. Create Position (NVDA $800 Put) ===');
  const pos4 = await api('POST', '/positions', {
    ticker: 'NVDA',
    strike_price: 800,
    premium_received: 1450,
    contracts: 1,
    expiration_date: '2026-04-18',
  }, token);
  console.log('Status:', pos4.status);
  if (pos4.data.id) {
    console.log('OK - Position ID:', pos4.data.id);
  } else {
    console.error('FAILED:', pos4.data);
  }

  console.log('\n=== 8. List Positions ===');
  const list = await api('GET', '/positions?page=1&limit=20', null, token);
  console.log('Status:', list.status);
  console.log('Count:', list.data.positions?.length, 'Pagination pages field:', list.data.pagination?.pages);
  if (list.data.pagination?.pages !== undefined) console.log('OK - pagination.pages exists');
  else console.error('MISSING pagination.pages');

  console.log('\n=== 9. Get Position Detail ===');
  const detail = await api('GET', `/positions/${pos1.data.id}`, null, token);
  console.log('Status:', detail.status);
  if (detail.data.ticker) {
    console.log('OK - direct position object, ticker:', detail.data.ticker);
  } else {
    console.error('FAILED - response:', Object.keys(detail.data));
  }

  console.log('\n=== 10. Resolve Position (TSLA - expired worthless) ===');
  const resolve = await api('POST', `/positions/${pos2.data.id}/resolve`, {
    resolution_type: 'expired_worthless',
    realized_pnl: 890,
  }, token);
  console.log('Status:', resolve.status);
  console.log('Response:', JSON.stringify(resolve.data).substring(0, 200));

  console.log('\n=== 11. Roll Position (MSFT) ===');
  const roll = await api('POST', `/positions/${pos3.data.id}/roll`, {
    ticker: 'MSFT',
    strike_price: 390,
    premium_received: 620,
    contracts: 1,
    expiration_date: '2026-06-20',
    notes: 'Rolled down and out',
  }, token);
  console.log('Status:', roll.status);
  if (roll.data.new_position) {
    console.log('OK - new position ID:', roll.data.new_position.id);
  } else {
    console.error('FAILED:', roll.data);
  }

  console.log('\n=== 12. Dashboard Stats (after trades) ===');
  const stats2 = await api('GET', '/admin/dashboard/stats', null, token);
  console.log('total_positions:', stats2.data.total_positions);
  console.log('open_positions:', stats2.data.open_positions);
  console.log('total_premium:', stats2.data.total_premium);
  console.log('capital_utilization:', stats2.data.capital_utilization);
  console.log('positions_expiring_soon:', stats2.data.positions_expiring_soon);

  console.log('\n=== 13. Create Investor ===');
  const inv = await api('POST', '/admin/investors', {
    email: 'investor@strikecapital.com',
    full_name: 'Test Investor',
    phone: '+60123456789',
    allocation_amount: 100000,
  }, token);
  console.log('Status:', inv.status);
  if (inv.data.temporary_password) {
    console.log('OK - temp password:', inv.data.temporary_password);
    console.log('User:', inv.data.user?.email);
  } else {
    console.error('FAILED:', JSON.stringify(inv.data).substring(0, 300));
  }

  console.log('\n=== 14. List Investors ===');
  const invList = await api('GET', '/admin/investors?page=1&limit=20', null, token);
  console.log('Status:', invList.status, 'Count:', invList.data.investors?.length);
  console.log('Pagination pages:', invList.data.pagination?.pages);

  console.log('\n=== 15. Create Announcement ===');
  const ann = await api('POST', '/admin/announcements', {
    title: 'Welcome to StrikeCapital',
    content: 'We are excited to launch our new CSP tracking platform.',
    is_active: true,
  }, token);
  console.log('Status:', ann.status);
  console.log('ID:', ann.data.id, 'Title:', ann.data.title);

  console.log('\n=== 16. List Announcements ===');
  const annList = await api('GET', '/admin/announcements?page=1&limit=20', null, token);
  console.log('Status:', annList.status, 'Count:', annList.data.announcements?.length);
  console.log('Pagination pages:', annList.data.pagination?.pages);

  console.log('\n=== 17. P&L Overview ===');
  const pnl = await api('GET', '/admin/pnl?period=all', null, token);
  console.log('Status:', pnl.status);
  console.log('Fields:', Object.keys(pnl.data));
  console.log('total_realized_pnl:', pnl.data.total_realized_pnl);

  console.log('\n=== 18. Risk Dashboard ===');
  const risk = await api('GET', '/admin/risk/dashboard', null, token);
  console.log('Status:', risk.status);
  console.log('Fields:', Object.keys(risk.data));
  if (risk.data.capital_utilization) console.log('OK - capital_utilization present');
  if (risk.data.ticker_concentration) console.log('OK - ticker_concentration present, count:', risk.data.ticker_concentration.length);
  if (risk.data.distance_distribution) console.log('OK - distance_distribution present');

  console.log('\n=== 19. Audit Trail ===');
  const audit = await api('GET', '/admin/audit?page=1&limit=50', null, token);
  console.log('Status:', audit.status, 'Count:', audit.data.logs?.length);
  console.log('Pagination pages:', audit.data.pagination?.pages);

  console.log('\n=== 20. Fund Settings Update ===');
  const settingsUp = await api('PUT', '/fund/settings', {
    fund_name: 'StrikeCapital by WYR',
    total_fund_capital: 480000,
    max_capital_per_position: 50000,
    max_positions: 20,
    default_alert_threshold: 5,
  }, token);
  console.log('Status:', settingsUp.status);
  console.log('max_capital_per_position:', settingsUp.data.max_capital_per_position);

  // Test investor login
  if (inv.data.temporary_password) {
    console.log('\n=== 21. Login as Investor ===');
    const invLogin = await api('POST', '/auth/login', {
      email: 'investor@strikecapital.com',
      password: inv.data.temporary_password,
    });
    if (invLogin.data.token) {
      const iToken = invLogin.data.token;
      console.log('OK - logged in as investor');

      console.log('\n=== 22. Investor Dashboard ===');
      const iDash = await api('GET', '/investor/dashboard', null, iToken);
      console.log('Status:', iDash.status);
      console.log('Fields:', Object.keys(iDash.data));
      console.log('allocation:', iDash.data.allocation);
      console.log('total_pnl_share:', iDash.data.total_pnl_share);

      console.log('\n=== 23. Investor Positions ===');
      const iPos = await api('GET', '/investor/positions?page=1&limit=20', null, iToken);
      console.log('Status:', iPos.status, 'Count:', iPos.data.positions?.length);
      console.log('Pagination pages:', iPos.data.pagination?.pages);

      console.log('\n=== 24. Investor P&L ===');
      const iPnl = await api('GET', '/investor/pnl?period=all', null, iToken);
      console.log('Status:', iPnl.status);
      console.log('Fields:', Object.keys(iPnl.data));
      console.log('total_pnl_share:', iPnl.data.total_pnl_share);

      console.log('\n=== 25. Investor History ===');
      const iHist = await api('GET', '/investor/history?page=1&limit=20', null, iToken);
      console.log('Status:', iHist.status);
      console.log('Fields:', Object.keys(iHist.data));
      if (iHist.data.stats) console.log('OK - stats field present');
      else console.error('MISSING stats field');

      console.log('\n=== 26. Investor Notifications ===');
      const iNotif = await api('GET', '/investor/notifications?page=1&limit=20', null, iToken);
      console.log('Status:', iNotif.status, 'Count:', iNotif.data.notifications?.length);
      console.log('unread_count:', iNotif.data.unread_count);
      console.log('Pagination pages:', iNotif.data.pagination?.pages);
    } else {
      console.error('Investor login FAILED:', invLogin.data);
    }
  }

  console.log('\n=== DONE ===');
}

run().catch(console.error);
