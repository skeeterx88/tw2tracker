SELECT * FROM ${worldId:name}.tribes
WHERE archived = false
ORDER BY tribes.${sortField:name} ${sortOrder:raw}
LIMIT ${limit} OFFSET ${offset}
