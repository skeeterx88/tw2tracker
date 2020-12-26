UPDATE public.worlds
SET village_count = ${villages},
    player_count = ${players},
    tribe_count = ${tribes}
WHERE world_id = ${worldId}
