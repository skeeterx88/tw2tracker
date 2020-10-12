INSERT INTO ${schema:name}.tribes
    (id, name, tag, points)
VALUES
    (${id}, ${name}, ${tag}, ${points})
ON CONFLICT (id) DO UPDATE 
SET name = excluded.name,
    tag = excluded.tag,
    points = excluded.points;
