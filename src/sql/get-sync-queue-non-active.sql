SELECT * FROM public.sync_queue
WHERE active = FALSE
ORDER BY id;
