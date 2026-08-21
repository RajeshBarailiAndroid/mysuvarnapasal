-- One row per shop (user): the entire POS store document as JSONB.
-- Controllers read the doc, mutate in memory, and write it back inside a
-- row-locked transaction — the exact atomicity model of the PHP Store class.
CREATE TABLE IF NOT EXISTS store_docs (
    user_id    VARCHAR(64) PRIMARY KEY,
    doc        JSONB       NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS store_docs_shop_name
    ON store_docs (LOWER(doc->'settings'->>'shopName'));
