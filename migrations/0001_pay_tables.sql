CREATE TABLE IF NOT EXISTS pay_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  sku_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  client_action_id TEXT,
  display_name TEXT DEFAULT '',
  amount TEXT DEFAULT '',
  quota_amount INTEGER DEFAULT 0,
  quota_unit TEXT DEFAULT '',
  status TEXT DEFAULT 'CREATED',
  purchase_url TEXT DEFAULT '',
  purchase_qr_code TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pay_orders_action ON pay_orders (user_id, client_action_id);
CREATE TABLE IF NOT EXISTS pay_consumptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  client_action_id TEXT,
  item_name TEXT DEFAULT '',
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  status TEXT DEFAULT 'CREATED',
  delivered INTEGER DEFAULT 0,
  redemption_id INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pay_consume_action ON pay_consumptions (user_id, client_action_id);
