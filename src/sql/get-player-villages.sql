SELECT *
FROM ${worldId:name}.villages
WHERE character_id = ${playerId}
ORDER BY points DESC
