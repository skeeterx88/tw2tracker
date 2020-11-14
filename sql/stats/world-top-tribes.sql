SELECT
    id,
    name,
    tag,
    points,
    victory_points,
    members,
    rank,
    villages
FROM ${worldId:name}.tribes
ORDER BY rank ASC LIMIT 10
