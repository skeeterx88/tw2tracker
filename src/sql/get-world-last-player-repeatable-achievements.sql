SELECT
    player_achievements.id,
    player_achievements.character_id,
    player_achievements.type,
    player_achievements.category,
    player_achievements.level,
    player_achievements.period,
    player_achievements.time_last_level,
    players.name player_name
FROM ${worldId:name}.player_achievements
LEFT OUTER JOIN ${worldId:name}.players
ON (${worldId:name}.player_achievements.character_id = players.id)
WHERE period IN (SELECT period FROM ${worldId:name}.player_achievements WHERE period LIKE ${period} ORDER BY time_last_level DESC LIMIT 1)
