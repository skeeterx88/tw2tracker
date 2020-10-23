INSERT INTO ${schema:name}.players
    (id, name, tribe_id, points, villages)
VALUES
    (${id}, ${name}, ${tribe_id}, ${points}, ${villages})
ON CONFLICT (id) DO UPDATE 
SET points = excluded.points,
    tribe_id = excluded.tribe_id,
    villages = excluded.villages;
