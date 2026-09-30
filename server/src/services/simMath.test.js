import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    quoteMid, optionFees, unrealizedPnl, marketValue, closedPutPnl, closedStockPnl, portfolioTotals,
    maxDrawdownPct, annualizedPct, tradeStats, isExpiryDue, isMarketOpen, expiryOutcome,
} from './simMath.js';

const pf = { starting_cash: 20000, fee_per_contract: 1.5, fee_per_stock_trade: 1 };

describe('quoteMid', () => {
    it('is the mid of bid and ask', () => {
        assert.deepEqual(quoteMid({ bid: 1.2, ask: 1.4, last: 9 }), { price: 1.3, source: 'mid' });
    });
    it('falls back to the last trade when a side is missing', () => {
        assert.deepEqual(quoteMid({ bid: 0, ask: 1.4, last: 1.25 }), { price: 1.25, source: 'last' });
        assert.deepEqual(quoteMid({}), { price: null, source: null });
    });
});

describe('put P&L', () => {
    const put = { position_type: 'option', status: 'OPEN', strike: 50, contracts: 2, entry_price: 2, entry_fees: 3, current_price: 1.2 };
    it('unrealized is premium minus cost to close minus entry fees', () => {
        assert.equal(unrealizedPnl(put), (2 - 1.2) * 200 - 3); // 157
    });
    it('a short put is a liability at the current mid', () => {
        assert.equal(marketValue(put), -240);
    });
    it('realized nets both sides of fees', () => {
        assert.equal(closedPutPnl({ entryPrice: 2, closePrice: 1.2, contracts: 2, entryFees: 3, exitFees: 3 }), 154);
        assert.equal(closedPutPnl({ entryPrice: 2, closePrice: 0, contracts: 1, entryFees: 1.5, exitFees: 0 }), 198.5);
    });
    it('stock P&L', () => {
        assert.equal(closedStockPnl({ costBasis: 50, salePrice: 48, shares: 100, entryFees: 0, exitFees: 1 }), -201);
    });
    it('fees are per contract', () => {
        assert.equal(optionFees(pf, 3), 4.5);
    });
});

describe('portfolioTotals', () => {
    it('total value = starting cash + realized + unrealized', () => {
        // Sold 2 puts at 2.00 (fees 3) → +397 cash; closed one earlier for +154 realized (bought back 1.20, fees 3)
        const open = { position_type: 'option', status: 'OPEN', strike: 50, contracts: 2, entry_price: 2, entry_fees: 3, current_price: 1.5 };
        const closed = { position_type: 'option', status: 'CLOSED', strike: 40, contracts: 2, entry_price: 2, realized_pnl: 154 };
        const ledger = 397 + (400 - 3) + (-240 - 3); // open leg, closed leg's open, closed leg's buy-back
        const t = portfolioTotals(pf, [open, closed], ledger);
        assert.equal(t.cash, 20000 + ledger);
        assert.equal(t.collateral, 10000);
        assert.equal(t.unrealized, (2 - 1.5) * 200 - 3);
        assert.equal(t.realized, 154);
        assert.equal(t.total_value, 20000 + t.realized + t.unrealized);
        assert.equal(t.free_cash, t.cash - 10000);
    });
});

describe('performance', () => {
    it('max drawdown is the worst peak-to-trough fall', () => {
        assert.equal(maxDrawdownPct([100, 120, 90, 130, 117]), 25);
        assert.equal(maxDrawdownPct([100, 101, 102]), 0);
    });
    it('annualized needs 30 days', () => {
        assert.equal(annualizedPct(100, 110, 10), null);
        assert.equal(annualizedPct(100, 110, 365), 10);
    });
    it('trade stats', () => {
        const s = tradeStats([
            { status: 'CLOSED', position_type: 'option', entry_price: 2, contracts: 1, realized_pnl: 150, open_date: '2026-09-01', close_date: '2026-09-11', close_reason: 'bought_to_close' },
            { status: 'CLOSED', position_type: 'option', entry_price: 1, contracts: 1, realized_pnl: -50, open_date: '2026-09-01', close_date: '2026-09-21', close_reason: 'assigned' },
            { status: 'OPEN', position_type: 'option', entry_price: 1, contracts: 1 },
        ]);
        assert.equal(s.closed_trades, 2);
        assert.equal(s.win_rate_pct, 50);
        assert.equal(s.avg_win, 150);
        assert.equal(s.avg_loss, -50);
        assert.equal(s.avg_days_held, 15);
        assert.equal(s.premium_captured_pct, 33.33);
        assert.equal(s.assignment_rate_pct, 50);
    });
});

describe('expiry and market hours (New York time)', () => {
    it('settles after 16:15 NY on expiry day, or any time after', () => {
        assert.equal(isExpiryDue('2026-10-16', new Date('2026-10-16T19:00:00Z')), false); // 15:00 NY
        assert.equal(isExpiryDue('2026-10-16', new Date('2026-10-16T20:30:00Z')), true); // 16:30 NY
        assert.equal(isExpiryDue('2026-10-16', new Date('2026-10-17T03:00:00Z')), true); // next day
        assert.equal(isExpiryDue('2026-10-16', new Date('2026-10-15T21:00:00Z')), false);
    });
    it('market hours', () => {
        assert.equal(isMarketOpen(new Date('2026-10-01T14:00:00Z')), true); // Thu 10:00 NY
        assert.equal(isMarketOpen(new Date('2026-10-01T12:00:00Z')), false); // 08:00 NY
        assert.equal(isMarketOpen(new Date('2026-10-03T15:00:00Z')), false); // Saturday
    });
    it('put is assigned when the underlying closes below the strike', () => {
        assert.equal(expiryOutcome(50, 49.99), 'assigned');
        assert.equal(expiryOutcome(50, 50), 'expired');
    });
});
