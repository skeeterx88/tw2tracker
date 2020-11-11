SELECT
    id,
    rank,
    name,
    tag,
    points,
    villages,
    members
FROM ${worldId:name}.tribes
WHERE name ILIKE ${query}
OR tag ILIKE ${query}
ORDER BY rank ASC
