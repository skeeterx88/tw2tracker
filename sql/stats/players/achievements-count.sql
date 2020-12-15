SELECT COUNT(*)::int
FROM ${worldId:name}.player_achievements
WHERE character_id = ${character_id}
