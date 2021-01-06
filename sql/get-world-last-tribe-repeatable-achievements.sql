SELECT
    tribe_achievements.id,
    tribe_achievements.type,
    tribe_achievements.category,
    tribe_achievements.level,
    tribe_achievements.period,
    tribe_achievements.time_last_level,
    tribes.tag tribe_tag
FROM ${worldId:name}.tribe_achievements
LEFT OUTER JOIN ${worldId:name}.tribes
ON (${worldId:name}.tribes.id = tribe_achievements.tribe_id)
WHERE period IN (SELECT period FROM ${worldId:name}.tribe_achievements WHERE period LIKE ${period} ORDER BY time_last_level DESC LIMIT 1)
