SELECT EXISTS (
    SELECT 1
    FROM information_schema.schemata
    WHERE schema_name = ${schema}::text
);
