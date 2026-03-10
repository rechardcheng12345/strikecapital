import bcrypt from 'bcryptjs';
export async function seed(knex) {
    // Clear existing entries in correct order (respecting foreign keys)
    await knex('notifications').del();
    await knex('pnl_records').del();
    await knex('announcements').del();
    await knex('investor_allocations').del();
    // Clear self-referencing FKs before deleting positions
    await knex('positions').update({ rolled_from_id: null, rolled_to_id: null, assigned_from_id: null, assigned_to_id: null });
    await knex('positions').del();
    await knex('fund_settings').del();
    await knex('refresh_tokens').del();
    await knex('audit_logs').del();
    await knex('market_data_cache').del();
    await knex('users').del();
    // ── Users ──────────────────────────────────────────────
    const adminHash = await bcrypt.hash('admin123', 10);
    const investorHash = await bcrypt.hash('investor123', 10);
    const [adminUser] = await knex('users')
        .insert({
        email: 'admin@strikecapital.com',
        password_hash: adminHash,
        full_name: 'Admin User',
        role: 'admin',
        is_active: true,
    });
    const [investorUser] = await knex('users')
        .insert({
        email: 'investor@strikecapital.com',
        password_hash: investorHash,
        full_name: 'Test Investor',
        role: 'investor',
        phone: '+60123456789',
        is_active: true,
    });
    const adminId = adminUser.id ?? adminUser;
    const investorId = investorUser.id ?? investorUser;
    // ── Fund Settings ──────────────────────────────────────
    await knex('fund_settings').insert({
        fund_name: 'StrikeCapital by WYR',
        total_fund_capital: 480000.00,
        max_capital_utilization: 80.00,
        max_single_position: 15.00,
        max_ticker_concentration: 25.00,
        risk_free_rate: 0.0525,
        max_capital_per_position: 50000.00,
        max_positions: 20,
        default_alert_threshold: 5.00,
        updated_by: adminId,
    });
    // ── Investor Allocation ────────────────────────────────
    await knex('investor_allocations').insert({
        user_id: investorId,
        invested_amount: 100000.00,
        allocation_pct: 20.83,
        start_date: '2026-03-08',
        is_active: true,
        created_by: adminId,
    });
    // ── Positions ──────────────────────────────────────────
    // Insert positions without roll references first
    const [aaplPos] = await knex('positions')
        .insert({
        ticker: 'AAPL',
        strike_price: 180.00,
        premium_received: 320.00,
        contracts: 2,
        expiration_date: '2026-04-18',
        open_date: '2026-03-08',
        status: 'OPEN',
        collateral: 36000.00,
        break_even: 178.40,
        max_profit: 320.00,
        position_type: 'option',
        notes: 'Test trade - AAPL put',
        created_by: adminId,
    });
    const [tslaPos] = await knex('positions')
        .insert({
        ticker: 'TSLA',
        strike_price: 250.00,
        premium_received: 890.00,
        contracts: 1,
        expiration_date: '2026-03-21',
        open_date: '2026-03-08',
        close_date: '2026-03-08',
        status: 'RESOLVED',
        resolution_type: 'expired_worthless',
        collateral: 25000.00,
        break_even: 241.10,
        max_profit: 890.00,
        realized_pnl: 890.00,
        position_type: 'option',
        notes: 'Near expiry test trade',
        created_by: adminId,
    });
    // MSFT original position (rolled)
    const [msftOriginal] = await knex('positions')
        .insert({
        ticker: 'MSFT',
        strike_price: 400.00,
        premium_received: 560.00,
        contracts: 1,
        expiration_date: '2026-05-16',
        open_date: '2026-03-08',
        close_date: '2026-03-08',
        status: 'RESOLVED',
        resolution_type: 'rolled',
        collateral: 40000.00,
        break_even: 394.40,
        max_profit: 560.00,
        position_type: 'option',
        created_by: adminId,
    });
    const [nvdaPos] = await knex('positions')
        .insert({
        ticker: 'NVDA',
        strike_price: 800.00,
        premium_received: 1450.00,
        contracts: 1,
        expiration_date: '2026-04-18',
        open_date: '2026-03-08',
        status: 'OPEN',
        collateral: 80000.00,
        break_even: 785.50,
        max_profit: 1450.00,
        position_type: 'option',
        created_by: adminId,
    });
    // MSFT rolled-to position
    const [msftRolled] = await knex('positions')
        .insert({
        ticker: 'MSFT',
        strike_price: 390.00,
        premium_received: 620.00,
        contracts: 1,
        expiration_date: '2026-06-20',
        open_date: '2026-03-08',
        status: 'OPEN',
        collateral: 39000.00,
        break_even: 383.80,
        max_profit: 620.00,
        position_type: 'option',
        notes: 'Rolled down and out',
        rolled_from_id: msftOriginal.id ?? msftOriginal,
        created_by: adminId,
    });
    // Update original MSFT with rolled_to reference
    await knex('positions')
        .where('id', msftOriginal.id ?? msftOriginal)
        .update({ rolled_to_id: msftRolled.id ?? msftRolled });
    // ── P&L Records ────────────────────────────────────────
    await knex('pnl_records').insert({
        position_id: tslaPos.id ?? tslaPos,
        record_date: '2026-03-08',
        pnl_amount: 890.00,
        pnl_type: 'realized',
        description: 'Position resolved: expired_worthless',
        created_by: adminId,
    });
    // ── Announcements ─────────────────────────────────────
    await knex('announcements').insert({
        title: 'Welcome to StrikeCapital',
        content: 'We are excited to launch our new CSP tracking platform.',
        priority: 'normal',
        is_active: true,
        published_at: knex.fn.now(),
        created_by: adminId,
    });
    // ── Notifications ──────────────────────────────────────
    const aaplId = aaplPos.id ?? aaplPos;
    const tslaId = tslaPos.id ?? tslaPos;
    const msftOrigId = msftOriginal.id ?? msftOriginal;
    const nvdaId = nvdaPos.id ?? nvdaPos;
    await knex('notifications').insert([
        {
            user_id: investorId,
            type: 'announcement',
            title: 'Welcome to StrikeCapital',
            message: 'We are excited to launch our new CSP tracking platform.',
            is_read: false,
            metadata: JSON.stringify({ announcement_id: 1 }),
        },
        {
            user_id: investorId,
            type: 'position_opened',
            title: 'New Position: AAPL $180 Put',
            message: '2 contract(s) opened with $320.00 premium received.',
            is_read: false,
            metadata: JSON.stringify({ position_id: aaplId }),
        },
        {
            user_id: investorId,
            type: 'position_opened',
            title: 'New Position: TSLA $250 Put',
            message: '1 contract(s) opened with $890.00 premium received.',
            is_read: false,
            metadata: JSON.stringify({ position_id: tslaId }),
        },
        {
            user_id: investorId,
            type: 'position_opened',
            title: 'New Position: MSFT $400 Put',
            message: '1 contract(s) opened with $560.00 premium received.',
            is_read: false,
            metadata: JSON.stringify({ position_id: msftOrigId }),
        },
        {
            user_id: investorId,
            type: 'position_opened',
            title: 'New Position: NVDA $800 Put',
            message: '1 contract(s) opened with $1450.00 premium received.',
            is_read: false,
            metadata: JSON.stringify({ position_id: nvdaId }),
        },
        {
            user_id: investorId,
            type: 'position_resolved',
            title: 'Position Resolved: TSLA $250.00 Put',
            message: 'Resolution: expired_worthless. Realized P&L: $890.00.',
            is_read: false,
            metadata: JSON.stringify({ position_id: tslaId, realized_pnl: 890, resolution_type: 'expired_worthless' }),
        },
    ]);
}
