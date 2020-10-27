UPDATE ${worldId:name}.tribes
SET best_villages = ${villages},
    best_villages_date = TIMEZONE('UTC', NOW())
WHERE id = ${tribe_id}
