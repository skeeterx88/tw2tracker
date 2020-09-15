INSERT INTO ${schema:name}.villages_by_player
    (character_id, villages_id)
VALUES
    (${character_id}, ${villages_id})
ON CONFLICT (character_id) DO UPDATE
SET villages_id = excluded.villages_id;
