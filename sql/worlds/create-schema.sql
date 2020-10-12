-- WORLD SCHEME

CREATE SCHEMA IF NOT EXISTS ${schema:name};

CREATE TABLE IF NOT EXISTS ${schema:name}.tribes (
    id INT PRIMARY KEY,
    name VARCHAR (255) NOT NULL,
    tag VARCHAR (3) NOT NULL,
    points INT
);

CREATE TABLE IF NOT EXISTS ${schema:name}.players (
    id INT PRIMARY KEY,
    name VARCHAR (255) NOT NULL,
    tribe_id INT REFERENCES ${schema:name}.tribes(id) NULL,
    points INT NOT NULL
);

CREATE TABLE IF NOT EXISTS ${schema:name}.villages (
    id INT PRIMARY KEY,
    x SMALLINT NOT NULL,
    y SMALLINT NOT NULL,
    name VARCHAR (255) NOT NULL,
    points SMALLINT NOT NULL,
    character_id INT REFERENCES ${schema:name}.players(id) NULL
);

CREATE TABLE IF NOT EXISTS ${schema:name}.villages_by_player (
    character_id INT REFERENCES ${schema:name}.players(id) PRIMARY KEY,
    villages_id INT[]
);
