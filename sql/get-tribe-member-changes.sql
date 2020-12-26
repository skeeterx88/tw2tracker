SELECT *
FROM ${worldId:name}.tribe_changes
WHERE old_tribe = ${id} OR new_tribe = ${id}
ORDER BY date DESC
