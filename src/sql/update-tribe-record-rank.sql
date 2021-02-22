UPDATE ${worldId:name}.tribes
SET best_rank = ${rank},
    best_rank_date = TIMEZONE('UTC', NOW())
WHERE id = ${id}
