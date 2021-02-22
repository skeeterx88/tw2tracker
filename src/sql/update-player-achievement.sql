UPDATE ${worldId:name}.player_achievements
SET level = ${level},
    time_last_level = ${time_last_level}
WHERE character_id = ${id} AND type = ${type}
