SELECT highlights, type, creation_date
FROM main.shared_maps
WHERE id = $1
AND world_market = $2
AND world_number = $3
