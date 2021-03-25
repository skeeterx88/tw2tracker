INSERT INTO ${worldId:name}.players (
    id,
    name,
    points,
    villages,
    points_per_villages,
    tribe_id,
    victory_points,
    rank,
    bash_points_off,
    bash_points_def,
    bash_points_total
) VALUES (
    ${id},
    ${name},
    ${points},
    ${villages},
    ${points_per_villages},
    ${tribe_id},
    ${victory_points},
    ${rank},
    ${bash_points_off},
    ${bash_points_def},
    ${bash_points_total}
)
ON CONFLICT (id) DO UPDATE 
SET points = excluded.points,
    villages = excluded.villages,
    points_per_villages = excluded.points_per_villages,
    tribe_id = excluded.tribe_id,
    victory_points = excluded.victory_points,
    rank = excluded.rank,
    bash_points_off = excluded.bash_points_off,
    bash_points_def = excluded.bash_points_def,
    bash_points_total = excluded.bash_points_total,
    last_seen = TIMEZONE('UTC', NOW()),
    archived = FALSE;
