SELECT EXISTS(
    SELECT 1
    FROM main.maps_share
    WHERE share_id = $1
)
