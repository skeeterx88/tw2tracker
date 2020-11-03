SELECT EXISTS(
    SELECT 1
    FROM main.worlds
    WHERE world_id = ${worldId}
)
