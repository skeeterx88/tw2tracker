SELECT id, name, points, villages, rank
FROM ${worldId:name}.players
WHERE tribe_id = ${tribeId}
ORDER BY rank
