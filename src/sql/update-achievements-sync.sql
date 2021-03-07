UPDATE public.worlds
SET last_achievements_sync_status = ${status},
    last_achievements_sync_date = NOW() AT TIME ZONE 'UTC'
WHERE world_id = ${worldId}
