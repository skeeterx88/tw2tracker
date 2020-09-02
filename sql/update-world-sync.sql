UPDATE 
    worlds
SET
    last_sync = NOW() AT TIME ZONE 'UTC'
WHERE
    market = $1
AND
    id = $2
