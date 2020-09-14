-- BASE

DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
SET TIMEZONE='UTC';

CREATE TABLE public.settings (
    site_name VARCHAR (255) NOT NULL,
    admin_password VARCHAR (255) NOT NULL,
    scrapper_interval_minutes SMALLINT NOT NULL
);

CREATE TABLE public.markets (
    id VARCHAR (10) PRIMARY KEY,
    account_name VARCHAR (255),
    account_password VARCHAR (255),
    account_token VARCHAR (255),
    account_id INT,
    enabled BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE public.worlds (
    market VARCHAR (10) REFERENCES markets(id),
    id SMALLINT PRIMARY KEY,
    name VARCHAR (255) NOT NULL,
    enabled BOOLEAN NOT NULL,
    last_sync TIMESTAMP
);

INSERT INTO settings (site_name, admin_password, scrapper_interval_minutes) VALUES ('tw2tracker', '123', 1);

-- INSERT INTO markets (id, account_name, account_password, enabled) VALUES ('beta', 'tribalwarstracker', '2tribalwarstracker2', TRUE);

-- INSERT INTO worlds (market, id, name, enabled, last_sync) VALUES ('br', 48, 'Visegrád', TRUE, NOW() AT TIME ZONE 'UTC');
-- INSERT INTO worlds (market, id, name, enabled, last_sync) VALUES ('br', 46, 'Tzschocha', TRUE, NOW() AT TIME ZONE 'UTC');
