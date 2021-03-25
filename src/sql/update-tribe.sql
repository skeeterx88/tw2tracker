UPDATE ${worldId:name}.tribes
SET name = ${name},
    tag = ${tag},
    points = ${points},
    villages = ${villages},
    points_per_member = ${points_per_member},
    points_per_villages = ${points_per_villages},
    victory_points = ${victory_points},
    rank = ${rank},
    members = ${members},
    level = ${level},
    bash_points_off = ${bash_points_off},
    bash_points_def = ${bash_points_def},
    bash_points_total = ${bash_points_total},
    last_seen = TIMEZONE('UTC', NOW()),
    archived = FALSE
WHERE id = ${id};
