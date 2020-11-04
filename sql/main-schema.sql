CREATE SCHEMA main;
SET TIMEZONE='UTC';

CREATE TABLE main.settings (
    site_name VARCHAR (255) NOT NULL,
    admin_password VARCHAR (255) NOT NULL,
    scrappe_all_interval VARCHAR (50) NOT NULL,
    register_worlds_interval VARCHAR (50) NOT NULL,
    clean_shares_check_interval VARCHAR (50) NOT NULL,
    static_share_expire_time INT NOT NULL
);

-- '30 */1 * * *' == At minute 30 past every hour
-- '10 */12 * * *' == At minute 10 past every 12th hour
-- '0 */12 * * *' == At minute 0 past every 12th hour
-- 129600 = 60 days
INSERT INTO main.settings VALUES ('Tw2-Tracker', '123', '30 */1 * * *', '10 */12 * * *', '0 */12 * * *', 129600);

CREATE TABLE main.state (
    last_scrappe_all_time TIMESTAMP DEFAULT NULL,
    last_register_worlds_time TIMESTAMP DEFAULT NULL,
    last_fetch_markets_time TIMESTAMP DEFAULT NULL
);

INSERT INTO main.state VALUES (NULL, NULL, NULL);

CREATE TABLE main.markets (
    id VARCHAR (10) PRIMARY KEY,
    account_name VARCHAR (255) DEFAULT 'tribalwarstracker',
    account_password VARCHAR (255) DEFAULT '7FONlraMpdnvrNIVE8aOgSGISVW00A'
);

CREATE TYPE map_sync_status AS ENUM ('success', 'fail');

CREATE TABLE main.worlds (
    market VARCHAR (10) REFERENCES main.markets(id),
    num SMALLINT,
    world_id VARCHAR (5),
    name VARCHAR (255) NOT NULL,
    last_sync TIMESTAMP,
    last_sync_status map_sync_status,
    open BOOLEAN NOT NULL DEFAULT TRUE,
    config JSONB,
    player_count INT DEFAULT 0,
    village_count INT DEFAULT 0,
    tribe_count INT DEFAULT 0
);

CREATE TYPE map_share_type AS ENUM ('static', 'dynamic');

CREATE TABLE main.maps_share (
    id SERIAL PRIMARY KEY,
    share_id VARCHAR (20) UNIQUE NOT NULL,
    world_market VARCHAR (10) REFERENCES main.markets(id),
    world_number SMALLINT,
    highlights TEXT NOT NULL,
    type map_share_type,
    center_x SMALLINT DEFAULT 500,
    center_y SMALLINT DEFAULT 500,
    settings TEXT NOT NULL,
    creation_date TIMESTAMP DEFAULT TIMEZONE('UTC', NOW()),
    last_access TIMESTAMP DEFAULT TIMEZONE('UTC', NOW())
);

CREATE TABLE main.session (
    sid VARCHAR NOT NULL COLLATE "default",
    sess JSON NOT NULL,
    expire TIMESTAMP (6) NOT NULL
) WITH (OIDS=FALSE);

ALTER TABLE main.session ADD CONSTRAINT session_pkey PRIMARY KEY (sid) NOT DEFERRABLE INITIALLY IMMEDIATE;
CREATE INDEX IDX_session_expire ON main.session (expire);

