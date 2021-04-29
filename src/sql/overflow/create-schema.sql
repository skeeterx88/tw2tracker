CREATE SCHEMA IF NOT EXISTS twoverflow;

CREATE TABLE IF NOT EXISTS twoverflow.usage (
    id SERIAL PRIMARY KEY,
    player_id TEXT NOT NULL,
    world_id TEXT NOT NULL,
    date TIMESTAMP DEFAULT TIMEZONE('UTC', NOW())
);

CREATE TABLE IF NOT EXISTS twoverflow.commands (
    id SERIAL PRIMARY KEY,
    date TEXT,
    date_type TEXT,
    player_id TEXT NOT NULL,
    world_id TEXT NOT NULL,
    arrive_time TIMESTAMP,
    type TEXT,
    units JSON,
    catapult_target TEXT,
    origin JSON,
    target JSON
);
