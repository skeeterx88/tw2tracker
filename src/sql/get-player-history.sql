SELECT
    players_history.*,
    tribes.tag tribe_tag
FROM ${worldId:name}.players_history
LEFT OUTER JOIN ${worldId:name}.tribes
ON (${worldId:name}.players_history.tribe_id = tribes.id)
WHERE character_id = ${playerId}
ORDER BY date DESC
LIMIT ${limit}
