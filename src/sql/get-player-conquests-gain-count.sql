SELECT COUNT(*)::int
FROM ${worldId:name}.conquests
WHERE new_owner = ${playerId}
AND old_owner != ${playerId}
