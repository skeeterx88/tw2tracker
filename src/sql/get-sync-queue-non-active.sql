SELECT * FROM public.sync_queue
WHERE active = FALSE AND type = ${type}
ORDER BY id;
