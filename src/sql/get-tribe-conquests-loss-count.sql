SELECT COUNT(*)::INT
FROM ${worldId:name}.conquests
WHERE old_owner_tribe_id = ${tribeId}
AND new_owner_tribe_id != ${tribeId}
