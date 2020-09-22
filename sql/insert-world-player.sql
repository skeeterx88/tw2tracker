INSERT INTO ${schema:name}.players
    (id, name, tribe_id, points)
VALUES
    (${id}, ${name}, ${tribe_id}, ${points})
ON CONFLICT (id) DO UPDATE 
SET points = excluded.points,
    tribe_id = excluded.tribe_id;
