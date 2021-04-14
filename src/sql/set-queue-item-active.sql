UPDATE public.sync_queue
SET active = TRUE
WHERE id = ${id};
