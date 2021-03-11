UPDATE public.sync_queue
SET active = ${active}
WHERE id = ${id};
