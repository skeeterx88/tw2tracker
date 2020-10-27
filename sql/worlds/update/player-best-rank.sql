UPDATE ${worldId:name}.players
SET best_rank = ${rank},
    best_rank_date = TIMEZONE('UTC', NOW())
WHERE id = ${character_id}
