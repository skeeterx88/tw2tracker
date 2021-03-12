INSERT INTO public.worlds (
    market,
    num,
    world_id,
    name,
    open
) VALUES (
    ${marketId},
    ${worldNumber},
    ${worldId},
    ${worldName},
    ${open}
);

CREATE SCHEMA IF NOT EXISTS ${worldId:name};

CREATE TABLE IF NOT EXISTS ${worldId:name}.tribes (
    id INT PRIMARY KEY,
    name VARCHAR (255) NOT NULL,
    tag VARCHAR (3) NOT NULL,
    points INT,
    points_per_member INT,
    points_per_villages INT,
    villages INT,
    victory_points INT,
    rank INT,
    first_seen TIMESTAMP DEFAULT TIMEZONE('UTC', NOW()),
    last_seen TIMESTAMP,
    members INT,
    level INT,
    archived BOOLEAN DEFAULT FALSE,

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
    bash_rank_total INT,

    avg_coords INT[] DEFAULT '{500,500}'
);

CREATE TABLE IF NOT EXISTS ${worldId:name}.players (
    id INT PRIMARY KEY,
    name VARCHAR (255) NOT NULL,
    tribe_id INT REFERENCES ${worldId:name}.tribes(id) NULL,
    points INT NOT NULL,
    villages INT DEFAULT 0,
    points_per_villages INT,
    rank INT,
    victory_points INT,
    first_seen TIMESTAMP DEFAULT TIMEZONE('UTC', NOW()),
    last_seen TIMESTAMP,
    archived BOOLEAN DEFAULT FALSE,

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
    bash_rank_total INT,

    avg_coords INT[] DEFAULT '{500,500}'
);

CREATE TABLE IF NOT EXISTS ${worldId:name}.provinces (
    id INT PRIMARY KEY,
    name VARCHAR (255) NOT NULL
);

CREATE TABLE IF NOT EXISTS ${worldId:name}.villages (
    id INT PRIMARY KEY,
    x SMALLINT NOT NULL,
    y SMALLINT NOT NULL,
    name VARCHAR (255) NOT NULL,
    points SMALLINT NOT NULL,
    character_id INT REFERENCES ${worldId:name}.players(id) NULL,
    province_id INT REFERENCES ${worldId:name}.provinces(id)
);

CREATE TABLE IF NOT EXISTS ${worldId:name}.villages_by_player (
    character_id INT REFERENCES ${worldId:name}.players(id) PRIMARY KEY,
    villages_id INT[]
);

CREATE TABLE IF NOT EXISTS ${worldId:name}.conquests (
    id SERIAL PRIMARY KEY,
    old_owner INT REFERENCES ${worldId:name}.players(id) NULL,
    new_owner INT REFERENCES ${worldId:name}.players(id) NOT NULL,
    date TIMESTAMP DEFAULT TIMEZONE('UTC', NOW()),
    village_id INT REFERENCES ${worldId:name}.villages(id) NOT NULL,
    village_points_then SMALLINT NOT NULL,
    old_owner_tribe_id INT REFERENCES ${worldId:name}.tribes(id) NULL,
    old_owner_tribe_tag_then VARCHAR (3) NULL,
    new_owner_tribe_id INT REFERENCES ${worldId:name}.tribes(id) NULL,
    new_owner_tribe_tag_then VARCHAR (3) NULL
);

CREATE TABLE IF NOT EXISTS ${worldId:name}.player_achievements (
    id SERIAL PRIMARY KEY,
    character_id INT,
    type VARCHAR (50) REFERENCES public.achievement_types(name),
    category achievement_categories,
    level SMALLINT NOT NULL,
    period VARCHAR (20),
    time_last_level TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ${worldId:name}.tribe_achievements (
    id SERIAL PRIMARY KEY,
    tribe_id INT,
    type VARCHAR (50) REFERENCES public.achievement_types(name),
    category achievement_categories,
    level SMALLINT NOT NULL,
    period VARCHAR (20),
    time_last_level TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ${worldId:name}.tribe_changes (
    id SERIAL PRIMARY KEY,
    character_id INT REFERENCES ${worldId:name}.players(id) NULL,
    old_tribe INT REFERENCES ${worldId:name}.tribes(id) NULL,
    new_tribe INT REFERENCES ${worldId:name}.tribes(id) NULL,
    date TIMESTAMP DEFAULT TIMEZONE('UTC', NOW()),
    old_tribe_tag_then VARCHAR (3) NULL,
    new_tribe_tag_then VARCHAR (3) NULL
);
