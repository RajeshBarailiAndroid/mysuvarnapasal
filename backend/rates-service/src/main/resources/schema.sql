CREATE TABLE IF NOT EXISTS shared_gold_rates (
    id         VARCHAR(32) PRIMARY KEY,
    ticks      JSONB NOT NULL DEFAULT '[]'::jsonb,
    history    JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at VARCHAR(32)
);
