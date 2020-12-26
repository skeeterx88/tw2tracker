SELECT *
FROM ${worldId:name}.tribe_achievements
WHERE tribe_id = ${id} AND level > 0
ORDER BY time_last_level DESC
