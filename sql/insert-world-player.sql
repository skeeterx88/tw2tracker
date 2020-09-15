INSERT INTO ${schema:name}.players
    (id, name, points)
VALUES
    (${id}, ${name}, ${points})
ON CONFLICT (id) DO UPDATE 
SET points = excluded.points;
