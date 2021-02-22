SELECT COUNT(*)::int
FROM ${worldId:name}.tribe_changes
WHERE character_id = ${id};
