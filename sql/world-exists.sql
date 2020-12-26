SELECT EXISTS(
    SELECT 1
    FROM public.worlds
    WHERE world_id = ${worldId}
)
