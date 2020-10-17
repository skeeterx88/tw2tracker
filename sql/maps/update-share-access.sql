UPDATE main.maps_share
SET last_access = TIMEZONE('UTC', NOW())
WHERE share_id = $1
