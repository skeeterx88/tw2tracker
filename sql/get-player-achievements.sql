SELECT *
FROM ${worldId:name}.player_achievements
WHERE character_id = ${id} AND level > 0
ORDER BY time_last_level DESC
