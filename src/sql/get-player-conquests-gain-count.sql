SELECT COUNT(*)
FROM ${worldId:name}.conquests
WHERE new_owner = ${playerId}
AND (old_owner != ${playerId} OR old_owner IS NULL)
