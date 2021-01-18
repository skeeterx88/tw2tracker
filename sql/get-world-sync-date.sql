SELECT last_sync FROM public.worlds
WHERE market = $1
AND num = $2
