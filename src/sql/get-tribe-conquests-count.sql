SELECT COUNT(*)::INT
FROM ${worldId:name}.conquests
WHERE old_owner_tribe_id = ${tribeId} OR new_owner_tribe_id = ${tribeId}
