SELECT * FROM ${worldId:name}.tribes
WHERE archived = false
ORDER BY rank ASC LIMIT ${limit} OFFSET ${offset}
