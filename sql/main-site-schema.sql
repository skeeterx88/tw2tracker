CREATE SCHEMA main;
SET TIMEZONE='UTC';

CREATE TABLE main.settings (
    site_name VARCHAR (255) NOT NULL DEFAULT 'tw2tracker',
    admin_password VARCHAR (255) NOT NULL DEFAULT '123',
    scrapper_interval_minutes SMALLINT NOT NULL DEFAULT 60
);

CREATE TABLE main.markets (
    id VARCHAR (10) PRIMARY KEY,
    account_name VARCHAR (255) DEFAULT 'tribalwarstracker',
    account_password VARCHAR (255) DEFAULT 'tribalwarstracker'
);

CREATE TABLE main.worlds (
    market VARCHAR (10) REFERENCES main.markets(id),
    num SMALLINT,
    name VARCHAR (255) NOT NULL,
    last_sync TIMESTAMP
);
