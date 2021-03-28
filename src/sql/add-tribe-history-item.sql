INSERT INTO ${worldId:name}.tribes_history (
    tribe_id,
    points,
    members,
    villages,
    rank,
    victory_points,
    bash_points_off,
    bash_points_def,
    bash_points_total
) VALUES (
    ${id},
    ${points},
    ${members},
    ${villages},
    ${rank},
    ${victory_points},
    ${bash_points_off},
    ${bash_points_def},
    ${bash_points_total}
);
