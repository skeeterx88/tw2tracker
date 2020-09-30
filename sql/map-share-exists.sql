SELECT EXISTS(
    SELECT 1
    FROM main.shared_maps
    WHERE id = $1
)
