export interface User {
  id: number;
  email: string;
  password_hash: string;
  full_name: string;
  role: 'investor' | 'admin';
  phone: string | null;
  reset_token: string | null;
  reset_token_expires: Date | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface Position {
  id: number;
  ticker: string;
  strike_price: number;
  premium_received: number;
  contracts: number;
  expiration_date: Date;
  open_date: Date;
  close_date: Date | null;
  status: 'OPEN' | 'MONITORING' | 'ROLLING' | 'EXPIRY' | 'RESOLVED';
  resolution_type: 'expired_otm' | 'assigned' | 'bought_to_close' | 'rolled' | null;
  current_price: number | null;
  implied_volatility: number | null;
  last_price_update: Date | null;
  collateral: number;
  break_even: number;
  max_profit: number;
  realized_pnl: number | null;
  close_premium: number | null;
  assignment_loss: number | null;
  rolled_from_id: number | null;
  rolled_to_id: number | null;
  notes: string | null;
  created_by: number;
  created_at: Date;
  updated_at: Date;
}

export interface FundSettings {
  id: number;
  fund_name: string;
  total_fund_capital: number;
  max_capital_utilization: number;
  max_single_position: number;
  max_ticker_concentration: number;
  risk_free_rate: number;
  updated_by: number | null;
  created_at: Date;
  updated_at: Date;
}

export interface InvestorAllocation {
  id: number;
  user_id: number;
  invested_amount: number;
  allocation_pct: number;
  start_date: Date;
  end_date: Date | null;
  is_active: boolean;
  notes: string | null;
  created_by: number | null;
  created_at: Date;
  updated_at: Date;
}

export interface PnlRecord {
  id: number;
  position_id: number;
  record_date: Date;
  pnl_amount: number;
  pnl_type: 'premium_income' | 'assignment_loss' | 'buyback_cost' | 'roll_credit' | 'roll_debit';
  description: string | null;
  created_by: number | null;
  created_at: Date;
}

export interface Announcement {
  id: number;
  title: string;
  content: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  is_active: boolean;
  published_at: Date | null;
  expires_at: Date | null;
  created_by: number;
  created_at: Date;
  updated_at: Date;
}

export interface Notification {
  id: number;
  user_id: number;
  type: 'position_opened' | 'position_resolved' | 'expiry_alert' | 'price_alert' | 'announcement' | 'pnl_update' | 'risk_alert';
  title: string;
  message: string;
  is_read: boolean;
  metadata: Record<string, any> | null;
  created_at: Date;
}

export interface AuditLog {
  id: number;
  user_id: number | null;
  action: string;
  entity_type: string;
  entity_id: number | null;
  old_values: Record<string, any> | null;
  new_values: Record<string, any> | null;
  ip_address: string | null;
  created_at: Date;
}

export interface MarketDataCache {
  id: number;
  ticker: string;
  current_price: number;
  previous_close: number | null;
  day_change_pct: number | null;
  fetched_at: Date;
  source: string;
}

// Express global user type
declare global {
  namespace Express {
    interface User {
      id: number;
      email: string;
      full_name: string;
      role: 'investor' | 'admin';
      is_active: boolean;
    }
  }
}
