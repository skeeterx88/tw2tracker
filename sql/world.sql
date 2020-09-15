SELECT
    market,
    num,
    name,
    last_sync
FROM
    worlds
WHERE
    market = $1
AND
    num = $2
