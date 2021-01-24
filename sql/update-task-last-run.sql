UPDATE public.tasks
SET last_run = TIMEZONE('UTC', NOW())
WHERE id = ${id}
