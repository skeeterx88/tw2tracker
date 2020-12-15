INSERT INTO ${worldId:name}.player_achievements (
    character_id,
    type,
    category,
    level,
    period,
    time_last_level
) VALUES (
    ${character_id},
    ${type},
    ${category},
    ${level},
    ${period},
    ${time_last_level}
)
