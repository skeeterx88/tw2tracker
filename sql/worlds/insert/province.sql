INSERT INTO ${worldId:name}.provinces
    (id, name)
VALUES
    (${province_id}, ${province_name})
ON CONFLICT (id) DO UPDATE
SET name = excluded.name;
