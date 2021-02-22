SELECT COUNT(*)::int
FROM ${worldId:name}.tribe_changes
WHERE old_tribe = ${id} OR new_tribe = ${id};
