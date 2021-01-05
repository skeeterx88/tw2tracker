UPDATE ${worldId:name}.tribe_achievements
SET level = ${level},
    time_last_level = ${time_last_level}
WHERE tribe_id = ${id} AND type = ${type}
