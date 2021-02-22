DELETE FROM public.maps_share
WHERE share_id = $1
AND type = 'static'
