CREATE TABLE IF NOT EXISTS users (
    id            BIGSERIAL PRIMARY KEY,
    name          VARCHAR(255) NOT NULL,
    username      VARCHAR(64)  NOT NULL UNIQUE,
    email         VARCHAR(255),
    phone         VARCHAR(64),
    password      VARCHAR(255) NOT NULL,
    token_version BIGINT       NOT NULL DEFAULT 0,
    email_verified_at TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS licenses (
    id          BIGSERIAL PRIMARY KEY,
    shop_name   VARCHAR(255) NOT NULL,
    key_hash    VARCHAR(64)  NOT NULL UNIQUE,
    license_key TEXT         NOT NULL,
    expiry      VARCHAR(10)  NOT NULL,
    revoked     BOOLEAN      NOT NULL DEFAULT FALSE,
    note        TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS license_activations (
    id          BIGSERIAL PRIMARY KEY,
    license_id  BIGINT      NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
    device_id   VARCHAR(64) NOT NULL,
    device_name VARCHAR(190),
    app_version VARCHAR(30),
    activated_at TIMESTAMPTZ,
    last_seen_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (license_id, device_id)
);
