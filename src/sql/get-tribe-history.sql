SELECT * FROM ${worldId:name}.tribes_history
WHERE tribe_id = ${tribeId}
ORDER BY date DESC
LIMIT ${limit}
