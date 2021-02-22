SELECT share_id, type, creation_date, settings, center_x, center_y
FROM public.maps_share
WHERE share_id = $1
AND world_market = $2
AND world_number = $3
