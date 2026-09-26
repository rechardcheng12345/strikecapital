// Turns a Roll Finder candidate into values for the existing Roll Position form.
export function rollPrefillFromCandidate(c, result) {
    const close = result.close;
    return {
        strike_price: c.strike,
        premium_received: c.new_credit,
        contracts: result.position.contracts,
        expiration_date: c.expiry,
        notes: `Roll Finder: bought back at $${Number(close.per_share).toFixed(2)}/sh ($${Number(close.cost).toFixed(2)}), sold ${c.expiry} $${c.strike}P at bid $${Number(c.bid).toFixed(2)} — net credit $${Number(c.net_credit).toFixed(2)}.`,
    };
}
