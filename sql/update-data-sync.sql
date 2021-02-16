UPDATE public.worlds
SET last_data_sync_status = $1,
    last_data_sync_date = NOW() AT TIME ZONE 'UTC'
WHERE market = $2
AND num = $3
RETURNING last_data_sync_date AS last_sync_date
