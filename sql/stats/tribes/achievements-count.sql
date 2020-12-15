SELECT COUNT(*)::int
FROM ${worldId:name}.tribe_achievements
WHERE tribe_id = ${tribe_id}
