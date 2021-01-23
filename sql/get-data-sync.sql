SELECT last_data_sync_status, last_data_sync_date
FROM public.worlds
WHERE market = $1
AND num = $2
