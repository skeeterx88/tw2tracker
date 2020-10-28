-- WORLD SCHEME

CREATE SCHEMA IF NOT EXISTS ${schema:name};

CREATE TABLE IF NOT EXISTS ${schema:name}.tribes (
    id INT PRIMARY KEY,
    name VARCHAR (255) NOT NULL,
    tag VARCHAR (3) NOT NULL,
    points INT,
    points_per_member INT,
    points_per_villages INT,
    villages INT,
    victory_points INT,
    rank INT,
    creating_date TIMESTAMP DEFAULT TIMEZONE('UTC', NOW()),
    members INT,
    level INT,

    best_rank INT,
    best_points INT,
    best_villages INT,

    best_rank_date TIMESTAMP,
    best_points_date TIMESTAMP,
    best_villages_date TIMESTAMP,

    bash_points_off INT,
    bash_points_def INT,
    bash_points_total INT,

    bash_rank_off INT,
    bash_rank_def INT,
    bash_rank_total INT
);

CREATE TABLE IF NOT EXISTS ${schema:name}.players (
    id INT PRIMARY KEY,
    name VARCHAR (255) NOT NULL,
    tribe_id INT REFERENCES ${schema:name}.tribes(id) NULL,
    points INT NOT NULL,
    villages INT DEFAULT 0,
    points_per_villages INT,
    rank INT,
    victory_points INT,

    best_rank INT,
    best_points INT,
    best_villages INT,

    best_rank_date TIMESTAMP,
    best_points_date TIMESTAMP,
    best_villages_date TIMESTAMP,

    bash_points_off INT,
    bash_points_def INT,
    bash_points_total INT,

    bash_rank_off INT,
    bash_rank_def INT,
    bash_rank_total INT
);

CREATE TABLE IF NOT EXISTS ${schema:name}.provinces (
    id INT PRIMARY KEY,
    name VARCHAR (255) NOT NULL
);

CREATE TABLE IF NOT EXISTS ${schema:name}.villages (
    id INT PRIMARY KEY,
    x SMALLINT NOT NULL,
    y SMALLINT NOT NULL,
    name VARCHAR (255) NOT NULL,
    points SMALLINT NOT NULL,
    character_id INT REFERENCES ${schema:name}.players(id) NULL,
    province_id INT REFERENCES ${schema:name}.provinces(id)
);

CREATE TABLE IF NOT EXISTS ${schema:name}.villages_by_player (
    character_id INT REFERENCES ${schema:name}.players(id) PRIMARY KEY,
    villages_id INT[]
);
