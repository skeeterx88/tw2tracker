UPDATE ${worldId:name}.players
SET best_points = ${points},
    best_points_date = TIMEZONE('UTC', NOW())
WHERE id = ${id}
