SELECT *
FROM ${worldId:name}.tribe_changes
WHERE character_id = ${id}
ORDER BY date ASC
