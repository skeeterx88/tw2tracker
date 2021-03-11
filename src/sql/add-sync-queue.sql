INSERT INTO public.sync_queue (
    type,
    market_id,
    world_number
) VALUES (
    ${type},
    ${market_id},
    ${world_number}
)
RETURNING id, market_id, world_number;
