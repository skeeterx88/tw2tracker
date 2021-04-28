SELECT COUNT(*)::INT
FROM ${worldId:name}.conquests
WHERE old_owner = ${playerId}
AND new_owner = ${playerId}
