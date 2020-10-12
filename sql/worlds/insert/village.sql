INSERT INTO ${schema:name}.villages
    (id, x, y, name, points, character_id, province_id)
VALUES
    (${id}, ${x}, ${y}, ${name}, ${points}, ${character_id}, ${province_id})
ON CONFLICT (id) DO UPDATE 
SET name = excluded.name,
    points = excluded.points,
    character_id = excluded.character_id;
