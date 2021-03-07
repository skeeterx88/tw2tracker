UPDATE public.worlds
SET sync_data_active = ${active}
WHERE world_id = ${worldId}
