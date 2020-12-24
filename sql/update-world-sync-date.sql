UPDATE main.worlds
SET last_sync = NOW() AT TIME ZONE 'UTC'
WHERE market = $1
AND num = $2
