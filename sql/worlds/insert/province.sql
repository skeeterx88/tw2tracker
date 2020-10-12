INSERT INTO ${schema:name}.provinces
    (id, name)
VALUES
    (${id}, ${name})
ON CONFLICT (id) DO NOTHING;
