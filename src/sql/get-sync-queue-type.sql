SELECT * FROM public.sync_queue
WHERE type = ${type}
ORDER BY id;
