UPDATE ${worldId:name}.players
SET points = ${points},
    villages = ${villages},
    points_per_villages = ${points_per_villages},
    tribe_id = ${tribe_id},
    victory_points = ${victory_points},
    rank = ${rank},
    bash_points_off = ${bash_points_off},
    bash_points_def = ${bash_points_def},
    bash_points_total = ${bash_points_total},
    last_seen = TIMEZONE('UTC', NOW()),
    archived = FALSE
WHERE id = ${playerId};
