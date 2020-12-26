UPDATE public.worlds
SET last_sync_status = $1
WHERE market = $2
AND num = $3
