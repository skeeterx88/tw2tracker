DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
SET TIMEZONE='UTC';

CREATE TABLE settings (
    site_name VARCHAR (255) NOT NULL,
    admin_password VARCHAR (255) NOT NULL,
    scrapper_interval_minutes SMALLINT NOT NULL
);

CREATE TABLE markets (
    id VARCHAR (10) PRIMARY KEY,
    account_name VARCHAR (255) DEFAULT 'tribalwarstracker',
    account_password VARCHAR (255) DEFAULT 'tribalwarstracker'
);

CREATE TABLE worlds (
    market VARCHAR (10) REFERENCES markets(id),
    num SMALLINT,
    name VARCHAR (255) NOT NULL,
    last_sync TIMESTAMP
);

INSERT INTO settings (site_name, admin_password, scrapper_interval_minutes) VALUES ('tw2tracker', '123', 1);
