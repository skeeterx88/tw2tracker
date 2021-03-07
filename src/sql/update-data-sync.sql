UPDATE public.worlds
SET last_data_sync_status = ${status},
    last_data_sync_date = NOW() AT TIME ZONE 'UTC'
WHERE world_id = ${worldId}
