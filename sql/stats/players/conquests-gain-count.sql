SELECT COUNT(*)
FROM ${worldId:name}.conquests
WHERE new_owner = ${playerId}
