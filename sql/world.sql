SELECT
    market,
    id,
    name,
    enabled,
    last_sync
FROM
    worlds
WHERE
    market = $1
AND
    id = $2
