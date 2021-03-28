INSERT INTO ${worldId:name}.players_history (
    character_id,
    tribe_id,
    points,
    villages,
    rank,
    victory_points,
    bash_points_off,
    bash_points_def,
    bash_points_total
) VALUES (
    ${id},
    ${tribe_id},
    ${points},
    ${villages},
    ${rank},
    ${victory_points},
    ${bash_points_off},
    ${bash_points_def},
    ${bash_points_total}
);
