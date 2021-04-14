SELECT COUNT(*)
FROM ${worldId:name}.conquests
WHERE new_owner_tribe_id = ${tribeId}
AND (old_owner_tribe_id != ${tribeId} OR old_owner_tribe_id IS NULL)
