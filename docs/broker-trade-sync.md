# Broker position sync on Refresh Prices

The admin Refresh Prices action first imports Moomoo executions, then refreshes quotes. It records supported stock purchases and short put openings, and resolves full stock sales and put buybacks using weighted execution prices. These are accounting records only; this feature never submits broker orders.

Setup:

- Apply migration `20261009000001_broker_trade_sync.js` on the platform database.
- Set `MOOMOO_ACCOUNT_ID` to the fund's exact real trading account on OpenD/the scanner proxy. US market (`MOOMOO_TRD_MARKET=2`) is supported.
- For hosted installations, deploy both `scanner-proxy/index.js` and `scanner-proxy/tradeExecutions.js`, restart the proxy, and configure the same `SCANNER_PROXY_SECRET` on the proxy and platform. The execution route requires authentication.
- Optional `MOOMOO_SYNC_START_DATE=YYYY-MM-DD` sets the initial import date. Otherwise the first successful refresh starts from that New York calendar day. The date and account are then persisted. Subsequent refreshes query from that date and skip recorded execution IDs, including after a restart. Previous historical trades are deliberately excluded by default.

Exact same-day manually entered trades are matched once rather than duplicated. New imports require execution quantities and direction to agree with current broker holdings. Closing requires exactly one matching open platform position, sufficient closing executions for its full quantity, and no remaining broker holding for that security. The transaction records the position, execution IDs, audit entry and realized P&L together. A database row lock serializes concurrent refreshes.

Partial closes remain pending until complete; partial-close accounting, scaling an existing position, multiple lots of the same security, calls, short stocks, fractional shares, assignments, and expiry without executions require manual review. Trades opened and fully closed before their first refresh also require manual entry. Warning messages explain skipped cases. Missing holdings alone never resolve a position. Broker execution failures leave positions unchanged while quote refresh still proceeds.

Execution data does not supply commissions or platform fees. Imported fees start at zero with a note to enter the actual fees manually. Realized P&L uses the existing gross-P&L convention; the platform accounts for entered fees separately.

Read-only API references: [Moomoo historical deals](https://openapi.moomoo.com/moomoo-api-doc/en/trade/get-history-order-fill-list.html), [today's deals](https://openapi.moomoo.com/moomoo-api-doc/en/trade/get-order-fill-list.html).

Verification: `node --test server/src/services/brokerTradePolicy.test.js` and `node scripts/test-broker-sync.mjs` (local staging only, all test changes rolled back).
