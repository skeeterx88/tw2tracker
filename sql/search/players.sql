SELECT
    players.id player_id,
    players.rank player_rank,
    players.name player_name,
    players.points player_points,
    players.villages player_villages,
    players.tribe_id,
    tribes.tag tribe_tag
FROM ${worldId:name}.players
LEFT OUTER JOIN ${worldId:name}.tribes
ON (${worldId:name}.players.tribe_id = tribes.id)
WHERE players.name ILIKE ${query}
ORDER BY players.rank ASC
