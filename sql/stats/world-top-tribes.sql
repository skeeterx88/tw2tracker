SELECT
    id,
    name,
    tag,
    points,
    members,
    rank,
    villages
FROM ${worldId:name}.tribes
ORDER BY rank ASC LIMIT 10
