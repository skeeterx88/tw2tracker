SELECT
    villages.id village_id,
    villages.name village_name,
    villages.x village_x,
    villages.y village_y,
    villages.character_id village_character_id,
    villages.points village_points,
    players.id player_id,
    players.name player_name
FROM ${worldId:name}.villages
LEFT OUTER JOIN ${worldId:name}.players
ON (${worldId:name}.villages.character_id = players.id)
WHERE ${worldId:name}.players.tribe_id = ${tribeId}
ORDER BY villages.points DESC
