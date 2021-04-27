SELECT * FROM public.worlds
WHERE open AND sync_enabled
ORDER BY market_id, world_number
