INSERT INTO main.shared_maps (world_market, world_number, type, highlights)
VALUES ($1, $2, $3, $4) RETURNING id
