INSERT INTO ${schema:name}.tribes
    (id, name, tag, points, villages)
VALUES
    (${id}, ${name}, ${tag}, ${points}, ${villages})
ON CONFLICT (id) DO UPDATE 
SET name = excluded.name,
    tag = excluded.tag,
    points = excluded.points,
    villages = excluded.villages;
