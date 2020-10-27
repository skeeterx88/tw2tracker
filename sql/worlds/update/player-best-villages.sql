UPDATE ${worldId:name}.players
SET best_villages = ${villages},
    best_villages_date = TIMEZONE('UTC', NOW())
WHERE id = ${character_id}
