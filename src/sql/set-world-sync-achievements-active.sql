UPDATE public.worlds
SET sync_achievements_active = ${active}
WHERE world_id = ${worldId}
