SELECT *
FROM ${worldId:name}.villages
WHERE character_id = ${character_id}
ORDER BY points DESC
