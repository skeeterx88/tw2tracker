INSERT INTO twoverflow.commands (
    date,
    date_type,
    player_id,
    world_id,
    arrive_time,
    type,
    units,
    catapult_target,
    origin,
    target
) VALUES (
    ${date},
    ${date_type},
    ${player_id},
    ${world_id},
    ${arrive_time},
    ${type},
    ${units},
    ${catapult_target},
    ${origin},
    ${target}
);
