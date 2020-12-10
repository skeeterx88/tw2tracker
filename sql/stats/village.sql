SELECT
    villages.id,
    villages.name,
    villages.x,
    villages.y,
    villages.character_id,
    villages.points,
    players.id player_id,
    players.name player_name,
    players.tribe_id,
    tribes.tag tribe_tag
FROM ${worldId:name}.villages
LEFT OUTER JOIN ${worldId:name}.players
ON (${worldId:name}.villages.character_id = players.id)
LEFT OUTER JOIN ${worldId:name}.tribes
ON (${worldId:name}.players.tribe_id = tribes.id)
WHERE villages.id = ${village_id}
ORDER BY villages.points DESC
