SELECT
    players.id,
    players.name,
    players.points,
    players.victory_points,
    players.villages,
    players.rank,
    players.tribe_id,
    tribes.name tribe_name,
    tribes.tag tribe_tag
FROM ${worldId:name}.players
LEFT OUTER JOIN ${worldId:name}.tribes
ON (${worldId:name}.players.tribe_id = tribes.id)
ORDER BY players.rank ASC
LIMIT ${limit} OFFSET ${offset}
