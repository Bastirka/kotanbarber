-- Kotāns booking schema. Run once via `npm run migrate` (safe to re-run — every
-- statement is idempotent, so it also upgrades a table created by an older version).

CREATE TABLE IF NOT EXISTS services (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  duration_min  INTEGER NOT NULL,
  price_eur     INTEGER NOT NULL,
  active        BOOLEAN NOT NULL DEFAULT true,
  sort_order    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS appointments (
  id                SERIAL PRIMARY KEY,
  service_id        INTEGER NOT NULL REFERENCES services(id),
  starts_at         TIMESTAMPTZ NOT NULL,
  ends_at           TIMESTAMPTZ NOT NULL,
  client_name       TEXT NOT NULL,
  phone             TEXT,
  telegram_user_id  BIGINT,
  telegram_username TEXT,
  source            TEXT NOT NULL DEFAULT 'web' CHECK (source IN ('web', 'telegram', 'manual')),
  mode              TEXT NOT NULL CHECK (mode IN ('queue', 'scheduled')),
  status            TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT appointments_has_contact CHECK (telegram_user_id IS NOT NULL OR phone IS NOT NULL OR source = 'manual')
);

-- Upgrade path for a table created before phone/source existed / before
-- telegram_user_id was made optional (web bookings have no Telegram id) /
-- before 'manual' (barber-entered, e.g. pre-existing walk-in bookings) existed.
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'web';
ALTER TABLE appointments ALTER COLUMN telegram_user_id DROP NOT NULL;
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_source_check;
ALTER TABLE appointments ADD CONSTRAINT appointments_source_check CHECK (source IN ('web', 'telegram', 'manual'));
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_has_contact;
ALTER TABLE appointments ADD CONSTRAINT appointments_has_contact CHECK (telegram_user_id IS NOT NULL OR phone IS NOT NULL OR source = 'manual');

CREATE INDEX IF NOT EXISTS idx_appointments_active_range
  ON appointments (starts_at, ends_at)
  WHERE status = 'confirmed';

-- Barbers / meistari
CREATE TABLE IF NOT EXISTS barbers (
  id               SERIAL PRIMARY KEY,
  name             TEXT NOT NULL,
  telegram_chat_id TEXT,
  active           BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Key-value settings (peak hours, surcharges, etc.)
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO settings (key, value) VALUES
  ('peak_hour_start',      '18'),
  ('peak_surcharge_pct',   '0'),
  ('same_day_surcharge_pct', '0')
ON CONFLICT (key) DO NOTHING;

-- Appointments: barber assignment + final price after surcharge
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS barber_id INTEGER REFERENCES barbers(id);
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS final_price_eur NUMERIC(6,2);

INSERT INTO services (name, duration_min, price_eur, sort_order) VALUES
  ('Matu griezums',        30, 15, 1),
  ('Griezums + bārda',     45, 22, 2),
  ('Bārdas korekcija',     20, 10, 3),
  ('Skūšana ar tvaiku',    30, 15, 4),
  ('Bērnu griezums',       25, 12, 5),
  ('Pensionāru griezums',  25, 12, 6)
ON CONFLICT (name) DO NOTHING;
