UPDATE ${worldId:name}.tribes
SET archived = TRUE,
    last_seen = TIMEZONE('UTC', NOW())
WHERE id = ${id}
