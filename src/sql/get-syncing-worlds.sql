SELECT
    world_id,
    sync_data_active,
    sync_achievements_active
FROM public.worlds
WHERE sync_data_active OR sync_achievements_active
