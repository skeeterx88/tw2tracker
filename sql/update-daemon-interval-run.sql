UPDATE public.daemon_intervals
SET last_run = TIMEZONE('UTC', NOW())
WHERE id = ${id}
