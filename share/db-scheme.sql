-- BASE

DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
SET TIMEZONE='UTC'

CREATE TABLE public.settings (
    site_name VARCHAR (255) NOT NULL,
    admin_password VARCHAR (255) NOT NULL,
    scrapper_allow_barbarians BOOLEAN NOT NULL,
    scrapper_interval_minutes SMALLINT NOT NULL
);

CREATE TABLE public.markets (
    id VARCHAR (10) PRIMARY KEY,
    account_name VARCHAR (255) NOT NULL,
    account_token VARCHAR (255) NOT NULL,
    account_id INT NOT NULL,
    enabled BOOLEAN NOT NULL
);

CREATE TABLE public.worlds (
    market VARCHAR (10) REFERENCES markets(id),
    id SMALLINT PRIMARY KEY,
    name VARCHAR (255) NOT NULL,
    enabled BOOLEAN NOT NULL,
    last_sync TIMESTAMP
);

INSERT INTO settings (site_name, admin_password, scrapper_allow_barbarians, scrapper_interval_minutes) VALUES ('TW2Logan', '123', TRUE, 30);
INSERT INTO markets (id, account_name, account_token, account_id, enabled) VALUES ('br', '-Relaxeaza-', '8910e7f5c7f8b6e042ea53dbcd9346d165aae17f', 650985, TRUE);
INSERT INTO worlds (market, id, name, enabled, last_sync) VALUES ('br', 48, 'Visegrád', TRUE, NOW() AT TIME ZONE 'UTC');
INSERT INTO worlds (market, id, name, enabled, last_sync) VALUES ('br', 46, 'Tzschocha', TRUE, NOW() AT TIME ZONE 'UTC');

-- NOW() AT TIME ZONE 'UTC'
