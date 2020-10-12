INSERT INTO main.maps_share (
    share_id,
    world_market,
    world_number,
    type,
    highlights,
    settings,
    center_x,
    center_y
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING creation_date
