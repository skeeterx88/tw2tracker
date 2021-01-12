SELECT COUNT(*)::int
FROM ${worldId:name}.conquests
WHERE old_owner = ${playerId}
AND new_owner != ${playerId}
