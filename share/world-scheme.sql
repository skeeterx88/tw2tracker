-- BASE

DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
SET TIMEZONE='UTC';

CREATE TABLE public.tribes (
    id INT PRIMARY KEY,
    name VARCHAR (255) NOT NULL,
    tag VARCHAR (3) NOT NULL,
    points INT
);

CREATE TABLE public.players (
    id INT PRIMARY KEY,
    name VARCHAR (255) NOT NULL,
    tribe_id INT REFERENCES tribes(id) NULL,
    points INT NOT NULL
);

CREATE TABLE public.villages (
    id INT PRIMARY KEY,
    x SMALLINT NOT NULL,
    y SMALLINT NOT NULL,
    name VARCHAR (255) NOT NULL,
    points SMALLINT NOT NULL,
    character_id INT REFERENCES players(id) NULL
);

CREATE TABLE public.villages_by_player (
    character_id INT REFERENCES players(id),
    villages_id INT[]
);
