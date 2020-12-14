SELECT COUNT(*)
FROM ${worldId:name}.conquests
WHERE old_owner = ${playerId}
